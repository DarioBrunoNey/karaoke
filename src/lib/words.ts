// Wortgenaue Textmarkierung, wenn nur Zeilen-Startzeiten vorliegen (LRC):
// Das Gesangstempo des Songs wird aus den dicht aufeinanderfolgenden Zeilen geschätzt (Sekunden je Silbe),
// daraus ergibt sich für jede Zeile, wie lange sie gesungen wird – Pausen danach zählen nicht mit.
// Innerhalb der Zeile bekommt jedes Wort Zeit proportional zu seiner Silbenzahl. Das ist eine Schätzung.
import type { LyricLine } from './types.ts'
import type { UsLine } from './ultrastar.ts'

export const syllables = (word: string) => Math.max(1, (word.toLowerCase().match(/[aeiouyäöüáéíóúàèìòùâêîôû]+/g) || []).length)

export function estimateWords(lines: LyricLine[]): UsLine[] {
  const info = lines.map((l, i) => {
    const words = l.text.split(/\s+/).filter(Boolean)
    const syl = words.reduce((a, w) => a + syllables(w), 0) || 1
    const gap = (lines[i + 1]?.t ?? l.t + 6) - l.t
    return { words, syl, gap }
  })
  const rates = info.filter((x) => x.gap > 0.4 && x.gap < 12 && x.syl >= 3).map((x) => x.gap / x.syl).sort((a, b) => a - b)
  // unteres Drittel = Zeilen ohne Pause dahinter → reines Gesangstempo
  const rate = Math.max(0.16, Math.min(0.6, rates.length ? rates[Math.floor(rates.length * 0.3)] : 0.3))
  return lines.map((l, i) => {
    const { words, syl, gap } = info[i]
    const dur = Math.max(0.5, Math.min(gap - 0.12, syl * rate * 1.05))
    let t = l.t
    const out: UsLine = { t: l.t, text: l.text, syl: [] }
    words.forEach((w, k) => {
      const d = (dur * syllables(w)) / syl
      out.syl.push({ t, e: t + d, n: w.length + (k ? 1 : 0) })
      t += d
    })
    if (!out.syl.length) out.syl.push({ t: l.t, e: l.t + dur, n: 1 })
    return out
  })
}
