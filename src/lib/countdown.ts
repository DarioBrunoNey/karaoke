/**
 * Sekunden bis zum nächsten Einsatz, wenn davor eine Pause von mindestens 3 s liegt (Songanfang,
 * Zwischenspiel) – sonst 0. i = Index der aktuellen Zeile (−1 vor der ersten), ends = Gesangsende je Zeile.
 */
export function secondsToEntry(lines: { t: number }[], ends: number[], i: number, t: number): number {
  const next = i < 0 ? 0 : t >= ends[i] ? i + 1 : -1
  if (next < 0 || next >= lines.length) return 0
  const from = i < 0 ? 0 : ends[i], to = lines[next].t
  const left = to - t
  return to - from >= 3 && left > 0 && left <= 3 ? left : 0
}

/** Aktualisiert die Countdown-Anzeige direkt im DOM (läuft in jedem Bild, daher ohne React-Neuzeichnen) */
export function paintCountdown(box: HTMLElement | null, left: number) {
  if (!box) return
  if (left <= 0) { if (box.style.opacity !== '0') box.style.opacity = '0'; return }
  box.style.opacity = '1'
  const n = Math.ceil(left), frac = left - Math.floor(left)
  const num = box.firstElementChild as HTMLElement
  if (num.textContent !== String(n)) num.textContent = String(n)
  num.style.transform = `scale(${1 + 0.35 * frac})`
  ;(box.lastElementChild!.firstElementChild as HTMLElement).style.width = `${(left / 3) * 100}%`
}
