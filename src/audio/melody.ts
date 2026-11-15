import { Yin, decimate, hzToMidi } from '../lib/pitch.ts'

export const MELODY_FPS = 50

/** Leitet aus einer (möglichst isolierten) Gesangsspur die Referenzmelodie ab. */
export function extractMelody(voc: Float32Array, sampleRate: number, onProgress?: (p: number) => void): Float32Array {
  const f = Math.max(1, Math.round(sampleRate / 11025))
  const sr = sampleRate / f
  const x = decimate(voc, f)
  // Hochpass ~130 Hz gegen Bass/Bassdrum-Reste
  const a = Math.exp((-2 * Math.PI * 130) / sr)
  let px = 0, py = 0
  for (let i = 0; i < x.length; i++) {
    const y = a * (py + x[i] - px)
    px = x[i]; py = y; x[i] = y
  }
  const size = 512
  const yin = new Yin(sr, size, 75, 1000)
  const n = Math.floor((x.length / sr) * MELODY_FPS)
  const midi = new Float32Array(n)
  const rms = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    const off = Math.round((k / MELODY_FPS) * sr) - size / 2
    if (off < 0 || off + size > x.length) continue
    const r = yin.detect(x, off, 0.12)
    rms[k] = r.rms
    if (r.hz > 0) midi[k] = hzToMidi(r.hz)
    if (onProgress && k % 500 === 0) onProgress(k / n)
  }
  // Lautstärke-Gate relativ zum lauten Teil des Songs
  const sorted = Float32Array.from(rms).sort()
  const gate = sorted[Math.floor(sorted.length * 0.9)] * 0.12
  for (let k = 0; k < n; k++) if (rms[k] < gate) midi[k] = 0
  return cleanMelody(midi)
}

export function cleanMelody(midi: Float32Array): Float32Array {
  const n = midi.length
  const out = new Float32Array(n)
  // Median über 5 Frames (nur stimmhafte Nachbarn)
  const win: number[] = []
  for (let k = 0; k < n; k++) {
    if (!midi[k]) continue
    win.length = 0
    for (let j = Math.max(0, k - 2); j <= Math.min(n - 1, k + 2); j++) if (midi[j]) win.push(midi[j])
    win.sort((p, q) => p - q)
    out[k] = win.length >= 3 ? win[win.length >> 1] : 0
  }
  // kurze Lücken (≤ 60 ms) schließen
  for (let k = 1; k < n - 3; k++) {
    if (!out[k] && out[k - 1]) {
      let e = k
      while (e < n && !out[e] && e - k < 3) e++
      if (e < n && out[e] && Math.abs(out[e] - out[k - 1]) < 3) for (let j = k; j < e; j++) out[j] = out[k - 1]
    }
  }
  // Fragmente < 120 ms verwerfen
  let s = -1
  for (let k = 0; k <= n; k++) {
    const v = k < n && out[k] > 0
    if (v && s < 0) s = k
    if (!v && s >= 0) {
      if (k - s < 6) for (let j = s; j < k; j++) out[j] = 0
      s = -1
    }
  }
  return out
}
