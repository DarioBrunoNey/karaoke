// Liest Karaoke-Dateien im UltraStar-Format (.txt): Text Silbe für Silbe plus Tonhöhe und Zeit jeder Note.
// Damit gibt es auch im Spotify-Modus eine Referenzmelodie für „zu hoch / zu tief" und echte Trefferpunkte.
export interface UsSyllable { t: number; e: number; n: number }
export interface UsLine { t: number; text: string; syl: UsSyllable[] }
export interface UsSong { title: string; artist: string; lines: UsLine[]; melody: Float32Array; fps: number; notes: number }

export const US_FPS = 50

export function parseUltraStar(src: string): UsSong {
  const head: Record<string, string> = {}
  const rows = src.replace(/^﻿/, '').split(/\r?\n/)
  for (const r of rows) {
    const m = r.match(/^#([A-Za-z0-9]+):(.*)$/)
    if (m) head[m[1].toUpperCase()] = m[2].trim()
  }
  const bpm = parseFloat((head.BPM || '').replace(',', '.'))
  if (!bpm) throw new Error('Keine gültige UltraStar-Datei: die Zeile #BPM fehlt.')
  const gap = parseFloat((head.GAP || '0').replace(',', '.')) / 1000
  const beat = 60 / (bpm * 4)
  const relative = /^yes$/i.test(head.RELATIVE || '')
  const lines: UsLine[] = []
  const noteList: { t: number; e: number; midi: number }[] = []
  let cur: UsLine | null = null
  let base = 0
  let end = 0
  for (const r of rows) {
    if (r.startsWith('E')) break
    const m = r.match(/^([:*FRG])\s*(-?\d+)\s+(\d+)\s+(-?\d+)(?: (.*))?$/)
    if (m) {
      const t = gap + (base + +m[2]) * beat
      const e = t + Math.max(1, +m[3]) * beat
      const raw = (m[5] ?? '').replace(/~/g, '')
      if (!cur) { cur = { t, text: '', syl: [] }; lines.push(cur) }
      cur.text += raw
      cur.syl.push({ t, e, n: raw.length })
      if (m[1] === ':' || m[1] === '*') noteList.push({ t, e, midi: 60 + +m[4] })
      end = Math.max(end, e)
      continue
    }
    const br = r.match(/^-\s*(-?\d+)(?:\s+(-?\d+))?/)
    if (br) {
      if (relative) base += +(br[2] ?? br[1])
      cur = null
    }
  }
  for (const l of lines) l.text = l.text.replace(/\s+/g, ' ').trim()
  if (!noteList.length) throw new Error('In der Datei wurden keine Noten gefunden.')
  const melody = new Float32Array(Math.ceil((end + 2) * US_FPS))
  for (const n of noteList) {
    // kleine Lücke am Notenende, damit aufeinanderfolgende gleiche Töne als Einsätze erkennbar bleiben
    const a = Math.max(0, Math.round(n.t * US_FPS)), b = Math.min(melody.length, Math.max(a + 1, Math.round(n.e * US_FPS)))
    for (let i = a; i < b; i++) melody[i] = n.midi
  }
  return { title: head.TITLE || '', artist: head.ARTIST || '', lines: lines.filter((l) => l.text), melody, fps: US_FPS, notes: noteList.length }
}

/** Anteil der Zeile (0…1), der zum Zeitpunkt t bereits gesungen ist – silbengenau */
export function syllableProgress(line: UsLine, t: number): number {
  let total = 0, done = 0
  for (const s of line.syl) {
    const n = Math.max(1, s.n)
    total += n
    if (t >= s.e) done += n
    else if (t > s.t) done += n * ((t - s.t) / Math.max(0.05, s.e - s.t))
  }
  return total ? done / total : 0
}
