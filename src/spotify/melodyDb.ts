// Notendaten automatisch finden: öffentliche Song-Sammlung des freien Karaoke-Projekts AllKaraoke (GitHub),
// Dateien im UltraStar-Format. Es werden nur Text-/Notendateien geladen, keine Audio- oder Videodaten.
// Die Dateien sind dort auf ein Musikvideo ausgerichtet; für Spotify wird der Zeitversatz anhand der
// Zeilenzeiten des synchronen Liedtexts automatisch bestimmt.
import type { LyricLine, SpTrack } from '../lib/types'
import { parseUltraStar, type UsSong } from '../lib/ultrastar'

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

/** Zeitversatz (Sekunden) zwischen Notendatei und Spotify-Aufnahme aus übereinstimmenden Textzeilen */
export function alignShift(us: UsSong, lrc: LyricLine[]): number | null {
  const L = lrc.map((l) => ({ t: l.t, n: norm(l.text) })).filter((l) => l.n.length >= 6)
  const bins = new Map<number, number[]>()
  let usable = 0
  for (const u of us.lines) {
    const un = norm(u.text)
    if (un.length < 6) continue
    usable++
    const key = un.slice(0, 10)
    for (const l of L) {
      if (l.n.startsWith(key) || un.startsWith(l.n.slice(0, 10))) {
        const d = l.t - u.t, b = Math.round(d / 0.25)
        if (!bins.has(b)) bins.set(b, [])
        bins.get(b)!.push(d)
      }
    }
  }
  let best: number[] = []
  for (const [b, v] of bins) {
    const all = [...(bins.get(b - 1) ?? []), ...v, ...(bins.get(b + 1) ?? [])]
    if (all.length > best.length) best = all
  }
  if (best.length < Math.min(3, usable) || best.length < usable * 0.25) return null
  best.sort((a, b) => a - b)
  return best[best.length >> 1]
}

export interface FoundMelody { text: string; aligned: boolean; shift: number }

export async function findMelody(track: SpTrack, lrc: LyricLine[]): Promise<FoundMelody | null> {
  const id = pick(await index(), track)
  if (!id) return null
  const r = await fetch(BASE + encodeURIComponent(id) + '.txt')
  if (!r.ok) return null
  let text = await r.text()
  const us = parseUltraStar(text)
  const shift = alignShift(us, lrc)
  if (shift !== null && Math.abs(shift) > 0.02) {
    // Versatz direkt in die #GAP-Zeile schreiben, damit die gespeicherte Datei schon zu Spotify passt
    text = text.replace(/^#GAP:(.*)$/m, (_m, g) => `#GAP:${(parseFloat(String(g).replace(',', '.')) || 0) + shift * 1000}`)
    if (!/^#GAP:/m.test(text)) text = `#GAP:${shift * 1000}\n` + text
  }
  return { text, aligned: shift !== null, shift: shift ?? 0 }
}
