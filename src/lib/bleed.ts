/**
 * Erkennt, wie laut die Musik (samt Originalsänger) im Mikrofon ankommt, und lässt nur durch, was klar lauter ist.
 * Gemessen wird in Phasen, in denen laut Song niemand singt (Intro, Zwischenspiele, Pausen zwischen den Zeilen).
 */
export class BleedGate {
  private buf: number[] = []
  /** Pegel der mitgehörten Musik (0 = noch nichts gemessen) */
  level = 0
  readonly factor: number
  /** @param factor so viel lauter als die Musik muss die Stimme sein (2 ≈ 6 dB) */
  constructor(factor = 2) { this.factor = factor }

  /** Messwert einspeisen; quiet = gerade soll niemand singen */
  feed(rms: number, quiet: boolean) {
    if (!quiet) return
    this.buf.push(rms)
    if (this.buf.length > 400) this.buf.shift()
    if (this.buf.length >= 12 && this.buf.length % 4 === 0) {
      const s = [...this.buf].sort((a, b) => a - b)
      this.level = s[Math.floor(s.length * 0.85)]
    }
  }
  /** Ist dieser Pegel laut genug, um die eigene Stimme zu sein? */
  passes(rms: number) { return rms > this.level * this.factor }
  reset() { this.buf = []; this.level = 0 }
}
