import { foldSemis } from './pitch.ts'
import type { Melody, ScoreResult } from './types.ts'

const W_PITCH = 0.7, W_RHYTHM = 0.1, W_TIMING = 0.1, W_CONT = 0.1

export type Difficulty = 'leicht' | 'mittel' | 'schwer'
/**
 * Toleranzen in Halbtönen: bis `full` volle Wertung, ab `zero` keine, bis `hit` zählt der Ton als getroffen.
 * `chance` ist der Erwartungswert bei zufälliger Tonhöhe und wird herausgerechnet (Brummen bringt nichts).
 */
export const LEVELS: Record<Difficulty, { hit: number; full: number; zero: number; chance: number }> = {
  leicht: { hit: 1.25, full: 0.7, zero: 2.0, chance: 0.225 },
  mittel: { hit: 0.8, full: 0.5, zero: 1.3, chance: 0.15 },
  schwer: { hit: 0.5, full: 0.35, zero: 0.9, chance: 0.105 },
}

export const AWARDS = [
  { min: 92, title: 'Superstar', emoji: '🌟', text: 'Stadion ausverkauft. Zugabe!' },
  { min: 82, title: 'Karaoke-Profi', emoji: '🎤', text: 'Das Publikum tobt.' },
  { min: 70, title: 'Bühnenheld', emoji: '🔥', text: 'Starker Auftritt – da geht noch mehr.' },
  { min: 55, title: 'Nachwuchstalent', emoji: '✨', text: 'Die Richtung stimmt.' },
  { min: 35, title: 'Duschsänger', emoji: '🚿', text: 'Unter der Dusche klingt es bestimmt besser.' },
  { min: 0, title: 'Mutige Seele', emoji: '🫶', text: 'Dabei sein ist alles.' },
]

export const lineVerdict = (r: number) => (r >= 0.85 ? 'Perfekt!' : r >= 0.65 ? 'Stark!' : r >= 0.4 ? 'Okay' : 'Daneben')

export type LiveState = 'none' | 'hit' | 'high' | 'low' | 'silent'

interface Phrase { s: number; e: number }

/**
 * Sammelt die erkannten Tonhöhen eines Auftritts und vergleicht sie mit der Referenzmelodie.
 * Alle Werte beruhen ausschließlich auf gemessenen Mikrofon-Frames – es gibt keine Zufallskomponente.
 */
export class ScoreSession {
  readonly ref: Float32Array
  readonly fps: number
  /** −1 = nicht aufgenommen, 0 = still, >0 = gesungene MIDI-Note */
  readonly user: Float32Array
  private lastIdx = -10
  private phrases: Phrase[]
  private refCount = 0
  readonly tol: (typeof LEVELS)[Difficulty]
  /** 1 = dieser Frame gehört zu einer sehr kurzen Note (Sprechgesang, nur Rhythmus zählt) */
  readonly short: Uint8Array

  constructor(melody: Melody, firstLyric = 0, level: Difficulty = 'mittel') {
    this.tol = LEVELS[level]
    this.fps = melody.fps
    this.ref = melody.data.slice()
    // Vor der ersten Textzeile wird nicht bewertet (Intro)
    const cut = Math.max(0, Math.floor((firstLyric - 1) * this.fps))
    for (let i = 0; i < cut && i < this.ref.length; i++) this.ref[i] = 0
    this.user = new Float32Array(this.ref.length).fill(-1)
    // Sehr kurze Noten (< 0,2 s) sind Sprechgesang: Kein Mensch trifft dabei jede Silbe auf den Halbton.
    // Dort zählt – wie bei Rap-Noten in Karaoke-Spielen – der Rhythmus: zur richtigen Zeit einen Ton von sich geben.
    this.short = new Uint8Array(this.ref.length)
    const minLen = Math.round(0.2 * this.fps)
    for (let i = 0; i < this.ref.length; ) {
      if (this.ref[i] <= 0) { i++; continue }
      let j = i
      // eine Note läuft, solange der Ton ohne Lücke und ohne Sprung weitergeht (Vibrato ist kein Sprung)
      j++
      while (j < this.ref.length && this.ref[j] > 0 && Math.abs(this.ref[j] - this.ref[j - 1]) < 0.8) j++
      if (j - i < minLen) this.short.fill(1, i, j)
      i = j
    }
    this.phrases = findPhrases(this.ref, this.fps)
    for (let i = 0; i < this.ref.length; i++) if (this.ref[i] > 0) this.refCount++
  }

  get hasReference() { return this.refCount > this.fps * 3 }

  /** t = Songzeit des Mikrofon-Frames (latenzbereinigt), midi = gesungene Note minus Transponierung */
  add(t: number, midi: number): LiveState {
    const i = Math.round(t * this.fps)
    if (i < 0 || i >= this.user.length) return 'none'
    this.user[i] = midi
    // Lücken bis ~¼ s mit dem letzten Wert füllen – auf langsamen Geräten (alte Laptops, Fernseher) kommen
    // die Messwerte unregelmäßig, das darf weder die Anzeige zerhacken noch Punkte kosten
    if (i - this.lastIdx > 1 && i - this.lastIdx <= 12) {
      const prev = this.user[this.lastIdx]
      for (let j = this.lastIdx + 1; j < i; j++) if (this.user[j] < 0) this.user[j] = prev
    }
    this.lastIdx = i
    const k = this.nearIdx(i, 3)
    if (k < 0) return 'none'
    if (midi <= 0) return 'silent'
    if (this.short[k]) return 'hit'
    const d = foldSemis(midi - this.ref[k])
    return Math.abs(d) <= this.tol.hit ? 'hit' : d > 0 ? 'high' : 'low'
  }

  /** Index des nächstgelegenen Noten-Frames im Umkreis von w Frames, sonst −1 */
  nearIdx(i: number, w: number): number {
    for (let k = 0; k <= w; k++) {
      if (i - k >= 0 && this.ref[i - k] > 0) return i - k
      if (i + k < this.ref.length && this.ref[i + k] > 0) return i + k
    }
    return -1
  }
  /** Zählt dieser gesungene Ton an dieser Stelle als getroffen? (kurze Noten: jeder Ton; sonst nach Toleranz) */
  isHit(i: number, midi: number, w = 4): boolean {
    const k = this.nearIdx(i, w)
    return k >= 0 && midi > 0 && (!!this.short[k] || Math.abs(foldSemis(midi - this.ref[k])) <= this.tol.hit)
  }

  refNear(i: number, w: number): number {
    for (let k = 0; k <= w; k++) {
      if (i - k >= 0 && this.ref[i - k] > 0) return this.ref[i - k]
      if (i + k < this.ref.length && this.ref[i + k] > 0) return this.ref[i + k]
    }
    return 0
  }

  /**
   * Schätzt, um wie viele Frames die Stimme insgesamt versetzt ankommt (Funkstrecke, drahtlose Bildübertragung,
   * Bluetooth): der Versatz, bei dem die meisten gesungenen Töne auf die Noten passen. 0 = kein klarer Befund.
   * Positiv = Stimme kommt zu spät an.
   */
  estimateLag(maxLate = 60, maxEarly = 10): number {
    const { ref, user } = this
    const n = ref.length, hit = this.tol.hit
    let best = 0, bestCount = 0, zero = 0
    const counts: number[] = []
    for (let lag = -maxEarly; lag <= maxLate; lag++) {
      let c = 0
      for (let i = Math.max(0, -lag); i < n - Math.max(0, lag); i += 2) {
        if (ref[i] <= 0 || this.short[i]) continue
        const u = user[i + lag]
        if (u > 0 && Math.abs(foldSemis(u - ref[i])) <= hit) c++
      }
      counts.push(c)
      if (lag === 0) zero = c
      if (c > bestCount) { bestCount = c; best = lag }
    }
    // nur bei klarem Befund: genug Treffer, und deutlich mehr als ohne Verschiebung
    if (bestCount < 100 || bestCount < zero * 1.12 + 10 || Math.abs(best) < 2) return 0
    // Schwerpunkt um das Maximum – glättet das Ergebnis
    let sw = 0, sx = 0
    for (let lag = best - 3; lag <= best + 3; lag++) {
      const c = counts[lag + maxEarly]
      if (c !== undefined && c > bestCount * 0.9) { sw += c; sx += c * lag }
    }
    return Math.round(sx / sw)
  }

  /** Verschiebt alles bisher Aufgenommene um n Frames nach vorn (positiv = früher) – nach erkanntem Versatz */
  shift(frames: number) {
    const u = this.user, n = u.length
    if (frames > 0) { u.copyWithin(0, frames); u.fill(-1, n - frames) }
    else if (frames < 0) { u.copyWithin(-frames, 0, n + frames); u.fill(-1, 0, -frames) }
    this.lastIdx -= frames
  }

  /** Trefferquote (0…1) für einen Zeitabschnitt, z. B. eine Textzeile; null, wenn dort nichts zu singen war */
  hitRatio(from: number, to: number): number | null {
    const { ref, user, fps } = this
    const a = Math.max(0, Math.round(from * fps)), b = Math.min(ref.length, Math.round(to * fps))
    const W = Math.round(0.08 * fps)
    let total = 0, hit = 0
    for (let i = a; i < b; i++) {
      if (ref[i] <= 0 || user[i] < 0) continue
      total++
      for (let j = Math.max(0, i - W); j <= Math.min(ref.length - 1, i + W); j++) {
        if (user[j] > 0 && (this.short[i] || Math.abs(foldSemis(user[j] - ref[i])) <= this.tol.hit)) { hit++; break }
      }
    }
    return total >= 10 ? hit / total : null
  }

  result(): ScoreResult {
    const { ref, user, fps } = this
    const n = ref.length
    const W = Math.round(0.06 * fps)   // ±60 ms Toleranz für Tonhöhenvergleich
    const { hit, full, zero, chance } = this.tol
    const WA = Math.round(0.15 * fps)  // ±150 ms für „singt / singt nicht"

    let refRec = 0, sung = 0, pitchSum = 0, exact = 0
    for (let i = 0; i < n; i++) {
      if (ref[i] <= 0 || user[i] < 0) continue
      refRec++
      let best = 99
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
        if (user[j] > 0) best = Math.min(best, this.short[i] ? 0 : Math.abs(foldSemis(user[j] - ref[i])))
      }
      if (best === 99) continue
      sung++
      if (best <= hit) exact++
      pitchSum += best <= full ? 1 : best >= zero ? 0 : (zero - best) / (zero - full)
    }
    const coverage = refRec ? sung / refRec : 0
    const rawPitch = sung ? pitchSum / sung : 0
    // Zufallstreffer herausrechnen; wer nur wenige Töne singt, bekommt nicht die volle Tonhöhenwertung
    const pitch = Math.max(0, (rawPitch - chance) / (1 - chance)) * Math.min(1, coverage / 0.3)
    const accuracy = sung ? exact / sung : 0

    // Rhythmus: Deckung von „Stimme aktiv" zwischen Sänger und Original (F1-Maß)
    let userVoiced = 0, userOnRef = 0, refCovered = 0
    for (let i = 0; i < n; i++) {
      if (user[i] > 0) {
        userVoiced++
        if (this.refNear(i, WA)) userOnRef++
      }
      if (ref[i] > 0 && user[i] >= 0) {
        for (let j = Math.max(0, i - WA); j <= Math.min(n - 1, i + WA); j++) if (user[j] > 0) { refCovered++; break }
      }
    }
    const precision = userVoiced ? userOnRef / userVoiced : 0
    const recall = refRec ? refCovered / refRec : 0
    const rhythm = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0

    // Einsatz/Timing und Kontinuität je Gesangsphrase
    let timingSum = 0, contSum = 0, phr = 0
    for (const p of this.phrases) {
      if (user[p.s] < 0 && user[Math.min(n - 1, p.s + 5)] < 0) continue // Phrase nicht gespielt
      phr++
      const from = Math.max(0, p.s - Math.round(0.4 * fps)), to = Math.min(n - 1, p.s + Math.round(1.0 * fps))
      let onset = -1
      for (let j = from; j <= to; j++) if (user[j] > 0 && (j === 0 || user[j - 1] <= 0 || j === from)) { onset = j; break }
      if (onset >= 0) {
        const delay = Math.abs(onset - p.s) / fps
        timingSum += 1 - Math.min(1, Math.max(0, (delay - 0.12) / 0.6))
      }
      let cov = 0, len = 0
      for (let i = p.s; i < p.e; i++) {
        if (ref[i] <= 0) continue
        len++
        for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) if (user[j] > 0) { cov++; break }
      }
      contSum += len ? Math.min(1, cov / len / 0.8) : 0
    }
    const timing = phr ? timingSum / phr : 0
    const continuity = phr ? contSum / phr : 0

    const total = Math.round(100 * (W_PITCH * pitch + W_RHYTHM * rhythm + W_TIMING * timing + W_CONT * continuity))
    const played = this.refCount ? refRec / this.refCount : 0
    const award = AWARDS.find((a) => total >= a.min)!
    return {
      total,
      accuracy: Math.round(accuracy * 100),
      stars: Math.round((total / 20) * 2) / 2,
      award: { title: award.title, emoji: award.emoji, text: award.text },
      parts: {
        pitch: Math.round(pitch * 100), rhythm: Math.round(rhythm * 100),
        timing: Math.round(timing * 100), continuity: Math.round(continuity * 100),
      },
      played,
      valid: played >= 0.5 && this.hasReference,
    }
  }
}

function findPhrases(ref: Float32Array, fps: number): Phrase[] {
  const out: Phrase[] = []
  const gap = Math.round(0.35 * fps), minLen = Math.round(0.3 * fps)
  let s = -1, lastVoiced = -1
  for (let i = 0; i <= ref.length; i++) {
    const v = i < ref.length && ref[i] > 0
    if (v) { if (s < 0) s = i; lastVoiced = i }
    else if (s >= 0 && (i - lastVoiced > gap || i === ref.length)) {
      if (lastVoiced + 1 - s >= minLen) out.push({ s, e: lastVoiced + 1 })
      s = -1
    }
  }
  return out
}
