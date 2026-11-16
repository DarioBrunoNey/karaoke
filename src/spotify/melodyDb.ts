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
  let best = { a: 1, b: 0, n: 0 }
  for (let k = -30; k <= 30; k++) {
    const a = 1 + k * 0.002
    const bins = new Map<number, Set<number>>()
    for (const [tu, tl, ui] of pairs) {
      const q = Math.round((tl - a * tu) / 0.3)
      for (const bb of [q - 1, q, q + 1]) { if (!bins.has(bb)) bins.set(bb, new Set()); bins.get(bb)!.add(ui) }
    }
    for (const [q, set] of bins) {
      // bei Gleichstand gewinnt das Tempo, das am nächsten am Original liegt
      if (set.size > best.n || (set.size === best.n && Math.abs(a - 1) < Math.abs(best.a - 1))) best = { a, b: q * 0.3, n: set.size }
    }
  }
  // Feinschliff: Ausgleichsgerade über alle Paare, die zur gefundenen Lösung passen
  let { a, b } = best
  let inl: [number, number, number][] = []
  for (let it = 0; it < 3; it++) {
    inl = pairs.filter(([tu, tl]) => Math.abs(tl - (a * tu + b)) <= (it === 0 ? 0.6 : 0.4))
    if (inl.length < 3) break
    const mx = inl.reduce((x, p) => x + p[0], 0) / inl.length, my = inl.reduce((x, p) => x + p[1], 0) / inl.length
    let sxy = 0, sxx = 0
    for (const [x, y] of inl) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx) }
    if (sxx > 100) { a = sxy / sxx; b = my - a * mx } else { a = 1; b = my - mx }
  }
  const lines = new Set(inl.map((p) => p[2])).size
  if (lines < Math.min(3, usable) || lines < usable * 0.4 || Math.abs(a - 1) > 0.07) return null
  return { a, b, inliers: lines, usable }
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
  if (fit) return { text: retime(text, fit), aligned: true }
  // Ohne brauchbaren Liedtext: nur übernehmen, wenn die Fassung gleich lang ist wie die Spotify-Aufnahme
  const dur = parseFloat(text.match(/^#ALLKARAOKE_DURATION:(.*)$/m)?.[1] ?? '0')
  if (!lrc.length && dur && Math.abs(dur - track.durationMs / 1000) <= 2) return { text, aligned: false }
  return null
}
