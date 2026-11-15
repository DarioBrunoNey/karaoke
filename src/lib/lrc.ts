import type { LyricLine } from './types.ts'

const TAG = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g

export function parseLrc(text: string): LyricLine[] {
  const out: LyricLine[] = []
  for (const raw of text.split(/\r?\n/)) {
    const times: number[] = []
    let m: RegExpExecArray | null
    TAG.lastIndex = 0
    let last = 0
    while ((m = TAG.exec(raw))) {
      times.push(parseInt(m[1]) * 60 + parseFloat(m[2].replace(':', '.')))
      last = TAG.lastIndex
    }
    if (!times.length) continue
    const line = raw.slice(last).replace(/<\d+:\d+(\.\d+)?>/g, '').trim()
    for (const t of times) out.push({ t, text: line })
  }
  return out.sort((a, b) => a.t - b.t)
}

export const isLrc = (text: string) => /\[\d{1,3}:\d{1,2}/.test(text)

export function toLrc(lines: LyricLine[]): string {
  return lines
    .map((l) => {
      const m = Math.floor(l.t / 60)
      const s = (l.t - m * 60).toFixed(2).padStart(5, '0')
      return `[${String(m).padStart(2, '0')}:${s}]${l.text}`
    })
    .join('\n')
}

/** Index der aktuell gesungenen Zeile (−1 vor der ersten) */
export function lineAt(lines: LyricLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, r = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].t <= t) { r = mid; lo = mid + 1 } else hi = mid - 1
  }
  return r
}
