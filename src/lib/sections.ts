// Teilt einen Song anhand der Textzeiten in Abschnitte (Strophen, Refrain), damit man einzelne Teile singen
// oder das Mikrofon abschnittsweise weitergeben kann. Grenze = längere Gesangspause; wiederkehrende
// Abschnitte mit gleichem Anfang gelten als Refrain.
export interface SectionLine { t: number; e: number; text: string }
export interface Section { s: number; e: number; label: string; first: string; from: number; to: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')

export function findSections(lines: SectionLine[]): Section[] {
  if (!lines.length) return []
  const gaps = lines.slice(0, -1).map((l, i) => lines[i + 1].t - l.e)
  const sorted = [...gaps].sort((a, b) => a - b)
  const med = sorted.length ? sorted[sorted.length >> 1] : 0
  const thr = Math.max(2.5, med * 2.5 + 1)
  let groups: [number, number][] = []
  let from = 0
  gaps.forEach((g, i) => { if (g > thr) { groups.push([from, i]); from = i + 1 } })
  groups.push([from, lines.length - 1])
  // sehr lange Abschnitte an ihrer größten inneren Pause teilen
  for (let guard = 0; guard < 40; guard++) {
    const k = groups.findIndex(([a, b]) => b - a + 1 > 10)
    if (k < 0) break
    const [a, b] = groups[k]
    let cut = a + 2, best = -1
    for (let i = a + 2; i <= b - 3; i++) if (gaps[i] > best) { best = gaps[i]; cut = i }
    groups.splice(k, 1, [a, cut], [cut + 1, b])
  }
  // einzelne Zeilen an den vorherigen Abschnitt hängen
  groups = groups.reduce<[number, number][]>((acc, g) => {
    if (g[1] === g[0] && acc.length && g[0] - acc[acc.length - 1][0] < 10) acc[acc.length - 1][1] = g[1]
    else acc.push(g)
    return acc
  }, [])
  const sig = groups.map(([a]) => norm(lines[a].text).slice(0, 16))
  let verse = 0
  return groups.map(([a, b], i) => {
    const chorus = sig[i].length >= 6 && sig.filter((x) => x === sig[i]).length >= 2
    return { s: lines[a].t, e: lines[b].e, label: chorus ? 'Refrain' : `Strophe ${++verse}`, first: lines[a].text, from: a, to: b }
  })
}
