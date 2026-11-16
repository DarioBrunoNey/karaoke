/**
 * Erkennt, wie laut die Musik (samt Originalsänger) im Mikrofon ankommt, und lässt nur durch, was klar lauter ist.
 * Gemessen wird in Phasen, in denen laut Song niemand singt (Intro, Zwischenspiele, Pausen zwischen den Zeilen).
 */
export class BleedGate {
  private buf: number[] = []
  /** Pegel der mitgehörten Musik (0 = noch nichts gemessen) */
  level = 0
  readonly factor: number
  readonly cap: number
  /**
   * @param factor so viel lauter als die Musik muss die Stimme sein (2 ≈ 6 dB)
   * @param cap Obergrenze für den Musikpegel. Wer im Intro schon summt, redet oder lacht, darf damit nicht
   *   die Schwelle so hoch treiben, dass später die eigene Stimme ausgesperrt wird.
   */
  constructor(factor = 2, cap = 0.12) { this.factor = factor; this.cap = cap }

  /** Messwert einspeisen; quiet = gerade soll niemand singen */
  feed(rms: number, quiet: boolean) {
    if (!quiet) return
    this.buf.push(rms)
    if (this.buf.length > 400) this.buf.shift()
    if (this.buf.length >= 6 && this.buf.length % 2 === 0) {
      // 70. Perzentil: gleichmäßige Musik bestimmt den Wert, einzelne laute Zwischenrufe nicht
      const s = [...this.buf].sort((a, b) => a - b)
      this.level = Math.min(this.cap, s[Math.floor(s.length * 0.7)])
    }
  }
  /** Ist dieser Pegel laut genug, um die eigene Stimme zu sein? */
  passes(rms: number) { return rms > this.level * this.factor }
  reset() { this.buf = []; this.level = 0 }
}
