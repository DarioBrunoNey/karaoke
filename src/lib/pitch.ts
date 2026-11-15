// YIN-Tonhöhenerkennung (de Cheveigné & Kawahara 2002) – eigene, schlanke Umsetzung.
// Wird sowohl live fürs Mikrofon als auch offline für die Referenzmelodie benutzt.

export const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'H']

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)
export const midiToName = (m: number) => {
  const r = Math.round(m)
  return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1)
}
/** Differenz in Halbtönen, oktavunabhängig, Bereich −6…+6 */
export const foldSemis = (d: number) => {
  d = d % 12
  if (d > 6) d -= 12
  if (d < -6) d += 12
  return d
}

export interface PitchResult { hz: number; clarity: number; rms: number }

export class Yin {
  private d: Float32Array
  private tauMin: number
  private tauMax: number
  readonly sampleRate: number
  readonly size: number
  constructor(sampleRate: number, size: number, minHz = 70, maxHz = 1000) {
    this.sampleRate = sampleRate
    this.size = size
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxHz))
    this.tauMax = Math.min(Math.floor(size / 2), Math.ceil(sampleRate / minHz))
    this.d = new Float32Array(this.tauMax + 1)
  }

  /** buf muss mindestens `size` Samples ab `off` enthalten */
  detect(buf: Float32Array, off = 0, threshold = 0.15): PitchResult {
    const { d, tauMin, tauMax, size } = this
    const w = size - tauMax
    let energy = 0
    for (let i = 0; i < size; i++) energy += buf[off + i] * buf[off + i]
    const rms = Math.sqrt(energy / size)
    if (rms < 1e-4) return { hz: 0, clarity: 0, rms }

    d[0] = 1
    let running = 0
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0
      for (let i = 0; i < w; i++) {
        const x = buf[off + i] - buf[off + i + tau]
        s += x * x
      }
      running += s
      d[tau] = running > 0 ? (s * tau) / running : 1
    }
    let tau = -1
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < threshold) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++
        tau = t
        break
      }
    }
    if (tau < 0) return { hz: 0, clarity: 0, rms }
    // parabolische Interpolation für Sub-Sample-Genauigkeit
    let better = tau
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1]
      const den = a + c - 2 * b
      if (den !== 0) better = tau + (a - c) / (2 * den)
    }
    return { hz: this.sampleRate / better, clarity: 1 - d[tau], rms }
  }
}

/** Grobe Dezimierung mit Mittelwert-Tiefpass – reicht für Grundtöne bis 1 kHz */
export function decimate(src: Float32Array, factor: number, out?: Float32Array): Float32Array {
  const n = Math.floor(src.length / factor)
  const o = out && out.length >= n ? out : new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    const b = i * factor
    for (let k = 0; k < factor; k++) s += src[b + k]
    o[i] = s / factor
  }
  return o
}
