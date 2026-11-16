// Notendaten automatisch finden: öffentliche Song-Sammlung des freien Karaoke-Projekts AllKaraoke (GitHub),
// Dateien im UltraStar-Format. Es werden nur Text-/Notendateien geladen, keine Audio- oder Videodaten.
// Die Dateien sind dort auf ein Musikvideo ausgerichtet; für Spotify wird der Zeitversatz anhand der
// Zeilenzeiten des synchronen Liedtexts automatisch bestimmt.
import type { LyricLine, SpTrack } from '../lib/types'
import { parseUltraStar, type UsSong } from '../lib/ultrastar.ts'

const BASE = 'https://raw.githubusercontent.com/Asvarox/allkaraoke/HEAD/public/songs/'
const IDX_KEY = 'encore-notes-index'
type Entry = [search: string, id: string]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]/g, '')
export const cleanTitle = (t: string) => t.replace(/\s+-\s+.*$/, '').replace(/\s*[([](feat|with|remaster|live|radio|single|album|mono|stereo|\d{4})[^)\]]*[)\]]/gi, '').trim()

let mem: Entry[] | null = null
async function index(): Promise<Entry[]> {
  if (mem) return mem
  try {
    const c = JSON.parse(localStorage.getItem(IDX_KEY) || 'null')
    if (c && Date.now() - c.at < 7 * 864e5) return (mem = c.list)
  } catch { /* neu laden */ }
  const r = await fetch(BASE + 'index.json')
  if (!r.ok) throw new Error('Notenverzeichnis nicht erreichbar')
  const raw: any[] = await r.json()
  const list: Entry[] = raw.filter((x) => x?.id).map((x) => [norm(`${x.artist ?? ''}${x.title ?? ''}`), x.id as string])
  mem = list
  try { localStorage.setItem(IDX_KEY, JSON.stringify({ at: Date.now(), list })) } catch { /* zu groß für den Speicher – dann eben je Sitzung */ }
  return list
}

function pick(list: Entry[], track: SpTrack): string | null {
  const title = norm(cleanTitle(track.name))
  if (title.length < 2) return null
  const artists = track.artists.split(',').map((a) => norm(a)).filter(Boolean)
  for (const a of artists) { const hit = list.find((e) => e[0] === a + title); if (hit) return hit[1] }
  // unscharf: Interpret und Titel müssen beide vorkommen, kürzester Eintrag gewinnt
  const cands = list.filter((e) => e[0].endsWith(title) && artists.some((a) => a.length >= 3 && e[0].includes(a)))
  cands.sort((x, y) => x[0].length - y[0].length)
  return cands[0]?.[1] ?? null
}

/** IDs der Titel, für die es Notendaten gibt (volle Anzeige mit Röhren) */
export async function tracksWithNotes(tracks: SpTrack[]): Promise<Set<string>> {
  const list = await index()
  return new Set(tracks.filter((t) => pick(list, t)).map((t) => t.id))
}

export interface Fit { a: number; b: number; inliers: number; usable: number }

/**
 * Passt die Zeitachse der Notendatei an die Spotify-Aufnahme an: t_spotify = a · t_noten + b.
 * b gleicht einen Vorspann aus (Musikvideo), a ein leicht anderes Tempo (andere Pressung/Fassung).
 * Grundlage sind Textzeilen, die in Notendatei und synchronem Liedtext gleich beginnen; wiederholte Zeilen
 * (Refrain) erzeugen falsche Paare, deshalb wird die Lösung gesucht, die die meisten Paare gleichzeitig erklärt.
 */
export function alignFit(us: UsSong, lrc: LyricLine[]): Fit | null {
  const L = lrc.map((l) => ({ t: l.t, n: norm(l.text) })).filter((l) => l.n.length >= 6)
  const pairs: [number, number, number][] = [] // [t_noten, t_lrc, Zeilenindex]
  let usable = 0
  us.lines.forEach((u, ui) => {
    const un = norm(u.text)
    if (un.length < 6) return
    usable++
    const key = un.slice(0, 10)
    for (const l of L) if (l.n.startsWith(key) || un.startsWith(l.n.slice(0, 10))) pairs.push([u.t, l.t, ui])
  })
  if (pairs.length < 3) return null
  // Für ein Tempo a: Wie viele Notenzeilen lassen sich mit EINEM Versatz erklären – und wie viele mit dem zweitbesten?
  const vote = (a: number) => {
    const bins = new Map<number, Set<number>>()
    for (const [tu, tl, ui] of pairs) {
      const q = Math.round((tl - a * tu) / 0.3)
      for (const bb of [q - 1, q, q + 1]) { if (!bins.has(bb)) bins.set(bb, new Set()); bins.get(bb)!.add(ui) }
    }
    let top = { q: 0, n: 0 }
    for (const [q, set] of bins) if (set.size > top.n) top = { q, n: set.size }
    let second = 0
    for (const [q, set] of bins) if (Math.abs(q - top.q) > 3 && set.size > second) second = set.size
    return { a, b: top.q * 0.3, n: top.n, second }
  }
  // Zuerst das Originaltempo. Ein anderes Tempo nur, wenn es deutlich mehr Zeilen erklärt – sonst liefe der Text
  // bei Songs mit anderem Aufbau (längeres Intro, anderes Solo) im falschen Tempo.
  let best = vote(1)
  for (let k = -30; k <= 30; k++) {
    if (k === 0) continue
    const v = vote(1 + k * 0.002)
    const ref = best.a === 1 ? best.n * 1.15 + 2 : best.n
    if (v.n > ref || (best.a !== 1 && v.n === best.n && Math.abs(v.a - 1) < Math.abs(best.a - 1))) best = v
  }
  // Bei Texten mit vielen gleichen Zeilen passen auch falsche Verschiebungen auf etliche Zeilen.
  // Die Lösung muss deshalb klar vor der zweitbesten liegen.
  if (best.n < best.second * 1.3 + 1) return null
  // Feinschliff: Tempo in kleinen Schritten um die gefundene Lösung variieren, den Versatz jeweils als Median der
  // passenden Paare bestimmen, und die Variante nehmen, die die meisten Zeilen eng (±0,25 s) erklärt.
  // (Eine Ausgleichsgerade wäre hier anfällig: Bei wiederholten Zeilen ziehen falsche Paare die Steigung weg.)
  let a = best.a, bb = best.b
  let inl: [number, number, number][] = []
  let top = -1
  for (let k = -8; k <= 8; k++) {
    const ak = best.a + k * 0.0005
    const near = pairs.filter(([tu, tl]) => Math.abs(tl - (ak * tu + best.b)) <= 0.9)
    if (near.length < 3) continue
    const res = near.map(([tu, tl]) => tl - ak * tu).sort((x, y) => x - y)
    const bk = res[res.length >> 1]
    const tight = pairs.filter(([tu, tl]) => Math.abs(tl - (ak * tu + bk)) <= 0.25)
    const n = new Set(tight.map((p) => p[2])).size
    // bei Gleichstand das Tempo, das näher an der groben Lösung liegt
    if (n > top || (n === top && Math.abs(k) < Math.abs(Math.round((a - best.a) / 0.0005)))) { top = n; a = ak; bb = bk; inl = pairs.filter(([tu, tl]) => Math.abs(tl - (ak * tu + bk)) <= 0.4) }
  }
  // Letzter Schliff: Ausgleichsgerade nur über eindeutige, eng passende Paare (je Notenzeile das beste) – und nur
  // übernehmen, wenn sie nah an der gefundenen Lösung bleibt.
  {
    const per = new Map<number, [number, number]>()
    for (const [tu, tl, ui] of pairs) {
      const r = Math.abs(tl - (a * tu + bb))
      if (r <= 0.3 && (!per.has(ui) || r < Math.abs(per.get(ui)![1] - (a * per.get(ui)![0] + bb)))) per.set(ui, [tu, tl])
    }
    const pts = [...per.values()]
    if (pts.length >= 6) {
      const mx = pts.reduce((x, q) => x + q[0], 0) / pts.length, my = pts.reduce((x, q) => x + q[1], 0) / pts.length
      let sxy = 0, sxx = 0
      for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx) }
      const slope = sxx > 0 ? sxy / sxx : a
      if (Math.sqrt(sxx / pts.length) > 25 && Math.abs(slope - a) < 0.003) {
        a = slope
        const res = pts.map(([x, y]) => y - a * x).sort((x, y) => x - y)
        bb = res[res.length >> 1]
        inl = pairs.filter(([tu, tl]) => Math.abs(tl - (a * tu + bb)) <= 0.4)
      }
    }
  }
  const b = bb
  const lines = new Set(inl.map((p) => p[2])).size
  // Die Notendatei teilt Zeilen oft feiner auf als der Liedtext – dann kann höchstens jede Textzeile einmal passen.
  const reachable = Math.min(usable, L.length)
  if (lines < Math.min(3, usable) || lines < reachable * 0.4 || Math.abs(a - 1) > 0.07) return null
  return { a, b, inliers: lines, usable }
}

/**
 * Findet Stellen, ab denen die Spotify-Aufnahme gegenüber der Notendatei versetzt weiterläuft (anderes Solo,
 * zusätzlicher Refrain, gekürzte Fassung). Liefert Sprungstellen [ab Zeit, Versatz] auf der bereits
 * angepassten Zeitachse. Ein Sprung gilt nur, wenn mehrere aufeinanderfolgende Zeilen ihn übereinstimmend zeigen.
 */
export function findJumps(us: UsSong, lrc: LyricLine[], fit: { a: number; b: number }): [number, number][] {
  const L = lrc.map((l) => ({ t: l.t, n: norm(l.text) })).filter((l) => l.n.length >= 6)
  // je Notenzeile: mögliche Abweichungen zum Liedtext (bei wiederholten Zeilen mehrere)
  const rows = us.lines.map((u) => {
    const un = norm(u.text), t = fit.a * u.t + fit.b
    const res = un.length < 6 ? [] : L.filter((l) => l.n.startsWith(un.slice(0, 10)) || un.startsWith(l.n.slice(0, 10))).map((l) => l.t - t)
    return { t, res }
  })
  const jumps: [number, number][] = []
  let d = 0
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.res.length || r.res.some((x) => Math.abs(x - d) <= 0.6)) continue
    // diese Zeile passt nicht mehr – zeigen die nächsten Zeilen denselben neuen Versatz?
    const next = rows.slice(i, i + 8).filter((x) => x.res.length).slice(0, 4)
    if (next.length < 2) continue
    let best = { v: 0, n: 0 }
    for (const v of next.flatMap((x) => x.res)) {
      const n = next.filter((x) => x.res.some((y) => Math.abs(y - v) <= 0.4)).length
      if (n > best.n || (n === best.n && Math.abs(v - d) < Math.abs(best.v - d))) best = { v, n }
    }
    if (best.n >= Math.min(3, next.length) && best.n >= 2 && Math.abs(best.v - d) > 0.6) {
      const hits = next.flatMap((x) => x.res.filter((y) => Math.abs(y - best.v) <= 0.4)).sort((x, y) => x - y)
      d = hits[hits.length >> 1]
      jumps.push([Math.max(0, r.t - 0.5), d])
    }
  }
  return jumps
}

export interface FoundMelody { text: string; aligned: boolean }

/** Schreibt Tempo und Startversatz so in die Datei, dass ihre Zeiten zur Spotify-Aufnahme passen */
function retime(text: string, f: { a: number; b: number }): string {
  const num = (v: string) => parseFloat(v.replace(',', '.')) || 0
  const gap = num(text.match(/^#GAP:(.*)$/m)?.[1] ?? '0')
  let out = text.replace(/^#BPM:(.*)$/m, (_m, v) => `#BPM:${num(String(v)) / f.a}`)
  const g = `#GAP:${f.a * gap + f.b * 1000}`
  out = /^#GAP:/m.test(out) ? out.replace(/^#GAP:.*$/m, g) : g + '\n' + out
  return out
}

/**
 * Sucht Notendaten zum Spotify-Titel. Liefert null, wenn es keine gibt – oder wenn sie sich nicht sicher
 * an der Spotify-Aufnahme ausrichten lassen (dann wären Röhren zur falschen Zeit schlimmer als keine).
 */
export async function findMelody(track: SpTrack, lrc: LyricLine[]): Promise<FoundMelody | null> {
  const id = pick(await index(), track)
  if (!id) return null
  const r = await fetch(BASE + encodeURIComponent(id) + '.txt')
  if (!r.ok) return null
  const text = await r.text()
  const us = parseUltraStar(text)
  const fit = alignFit(us, lrc)
  if (fit) {
    let out = retime(text, fit)
    const jumps = findJumps(us, lrc, fit)
    if (jumps.length) out = `#ENCOREWARP:${jumps.map(([t, d]) => `${t.toFixed(2)}:${d.toFixed(2)}`).join(';')}\n` + out.replace(/^#ENCOREWARP:.*\n/m, '')
    return { text: out, aligned: true }
  }
  // Ohne brauchbaren Liedtext: nur übernehmen, wenn die Fassung gleich lang ist wie die Spotify-Aufnahme
  const dur = parseFloat(text.match(/^#ALLKARAOKE_DURATION:(.*)$/m)?.[1] ?? '0')
  if (!lrc.length && dur && Math.abs(dur - track.durationMs / 1000) <= 2) return { text, aligned: false }
  return null
}
