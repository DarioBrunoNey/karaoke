// Bewertung OHNE Originalmelodie (Spotify-Modus ohne Melodie-Datei).
// Gemessen wird, was sich aus der eigenen Stimme und den Textzeiten sicher ableiten lässt:
//   Tonsicherheit – werden klare, gehaltene Töne gesungen, die zusammen in eine Tonart passen?
//   Rhythmus      – wird gesungen, während Textzeilen laufen (und nicht in den Pausen)?
//   Einsatz       – beginnt der Gesang pünktlich zu jeder Zeile?
//   Kontinuität   – werden die Zeilen durchgesungen?
// Ob genau die richtige Melodie gesungen wurde, kann diese Wertung nicht wissen – das sagt die App auch so.
import { AWARDS } from './scoring.ts'
import type { LyricLine, ScoreResult } from './types.ts'

const clamp = (x: number) => Math.max(0, Math.min(1, x))
const MAJOR = [0, 2, 4, 5, 7, 9, 11]

export function freeScore(user: Float32Array, fps: number, lines: LyricLine[]): ScoreResult {
  const n = user.length
  let recorded = 0, voiced = 0
  for (let i = 0; i < n; i++) { if (user[i] >= 0) recorded++; if (user[i] > 0) voiced++ }

  // 1) Gehaltene Töne finden: ≥ 160 ms innerhalb ±0,6 Halbtönen um den laufenden Mittelwert
  const notes: { pitch: number; len: number }[] = []
  let stableFrames = 0
  const minLen = Math.round(0.16 * fps)
  let i = 0
  while (i < n) {
    if (!(user[i] > 0)) { i++; continue }
    let sum = user[i], cnt = 1, j = i + 1
    while (j < n && user[j] > 0 && Math.abs(user[j] - sum / cnt) <= 0.6) { sum += user[j]; cnt++; j++ }
    if (cnt >= minLen) { notes.push({ pitch: sum / cnt, len: cnt }); stableFrames += cnt }
    i = j
  }
  const stability = voiced ? stableFrames / voiced : 0

  // 2) Passen die gehaltenen Töne in eine gemeinsame Tonart? (beste von 12 Tonarten, Stimmung frei)
  let inScale = 0
  const classes = new Float32Array(12)
  if (stableFrames) {
    for (let o = -0.5; o < 0.5; o += 0.05) {
      const hist = new Float32Array(12)
      let near = 0
      for (const nt of notes) {
        const p = nt.pitch - o, r = Math.round(p)
        if (Math.abs(p - r) <= 0.35) { hist[((r % 12) + 12) % 12] += nt.len; near += nt.len }
      }
      for (let k = 0; k < 12; k++) {
        let w = 0
        for (const d of MAJOR) w += hist[(k + d) % 12]
        if (w / stableFrames > inScale) { inScale = w / stableFrames; classes.set(hist) }
      }
      void near
    }
  }
  let distinct = 0
  for (let k = 0; k < 12; k++) if (classes[k] > stableFrames * 0.04) distinct++
  const variety = clamp(distinct / 4) // wer nur einen Ton brummt, bekommt keine volle Tonwertung

  // 3) Textzeilen als Zeitfenster
  const win = lines.map((l, k) => {
    const next = lines[k + 1]?.t ?? l.t + 8
    const e = Math.min(next, l.t + Math.max(1.5, l.text.length * 0.11 + 0.8))
    return { s: Math.round(l.t * fps), e: Math.round(e * fps) }
  }).filter((w) => w.s < n && user[Math.min(n - 1, w.s)] >= 0)

  let timing = 0, cont = 0, winFrames = 0, winVoiced = 0, voicedInWin = 0
  const inWin = new Uint8Array(n)
  for (const w of win) {
    const a = Math.max(0, w.s - Math.round(0.2 * fps)), b = Math.min(n - 1, w.e + Math.round(0.3 * fps))
    for (let k = a; k <= b; k++) inWin[k] = 1
    let v = 0
    for (let k = w.s; k < Math.min(n, w.e); k++) if (user[k] > 0) v++
    const len = Math.max(1, Math.min(n, w.e) - w.s)
    winFrames += len; winVoiced += v
    if (v / len >= 0.35) cont++
    const from = Math.max(0, w.s - Math.round(0.5 * fps)), to = Math.min(n - 1, w.s + Math.round(1.0 * fps))
    for (let k = from; k <= to; k++) {
      if (user[k] > 0 && (k === from || !(user[k - 1] > 0))) {
        timing += 1 - clamp((Math.abs(k - w.s) / fps - 0.2) / 0.7)
        break
      }
    }
  }
  for (let k = 0; k < n; k++) if (user[k] > 0 && inWin[k]) voicedInWin++

  const coverage = win.length ? clamp(winVoiced / Math.max(1, winFrames) / 0.5) : clamp(voiced / Math.max(1, recorded) / 0.35)
  const pitch = (0.5 * clamp((stability - 0.3) / 0.5) + 0.5 * clamp((inScale - 0.6) / 0.35)) * variety * clamp(coverage / 0.4)
  let rhythm: number, timingS: number, continuity: number
  if (win.length) {
    const precision = voiced ? voicedInWin / voiced : 0
    rhythm = precision + coverage > 0 ? (2 * precision * coverage) / (precision + coverage) : 0
    timingS = timing / win.length
    continuity = cont / win.length
  } else {
    rhythm = timingS = continuity = coverage
  }
  const total = Math.round(100 * (0.6 * pitch + 0.1 * rhythm + 0.15 * timingS + 0.15 * continuity))
  const award = AWARDS.find((a) => total >= a.min)!
  const played = n ? recorded / n : 0
  return {
    total, accuracy: Math.round(inScale * 100), stars: Math.round((total / 20) * 2) / 2,
    award: { title: award.title, emoji: award.emoji, text: award.text },
    parts: { pitch: Math.round(pitch * 100), rhythm: Math.round(rhythm * 100), timing: Math.round(timingS * 100), continuity: Math.round(continuity * 100) },
    played, valid: played >= 0.5,
  }
}
