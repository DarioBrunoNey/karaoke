import { foldSemis } from '../lib/pitch'
import type { ScoreSession } from '../lib/scoring'

/** Tonhöhen-Bahn: Referenzmelodie als Balken, eigene Stimme als Leuchtspur */
export function drawLane(cv: HTMLCanvasElement | null, s: ScoreSession, t: number, center: { current: number }, userNow: number) {
  if (!cv) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  const g = cv.getContext('2d')!
  g.clearRect(0, 0, w, h)
  const span = 6, back = 1.8, fps = s.fps, ref = s.ref, user = s.user
  const x = (time: number) => ((time - (t - back)) / span) * w
  const RANGE = 14
  const row = h / RANGE
  const y = (m: number) => h / 2 - (m - center.current) * row
  const i0 = Math.max(0, Math.floor((t - back) * fps)), i1 = Math.min(ref.length - 1, Math.ceil((t - back + span) * fps))

  // Blickfeld weich auf die kommende Melodie zentrieren
  let sum = 0, cnt = 0
  for (let i = Math.max(0, Math.floor(t * fps)); i <= i1; i++) if (ref[i] > 0) { sum += ref[i]; cnt++ }
  if (cnt > 5) center.current += (sum / cnt - center.current) * 0.03

  // Referenz-Balken (auf Halbtöne gerastert)
  const bh = Math.max(6 * dpr, row * 1.15)
  let segStart = -1, segNote = 0
  for (let i = i0; i <= i1 + 1; i++) {
    const n = i <= i1 && ref[i] > 0 ? Math.round(ref[i]) : 0
    if (n !== segNote) {
      if (segNote) {
        const xa = x(segStart / fps), xb = x(i / fps)
        g.fillStyle = 'rgba(255,255,255,.2)'
        g.beginPath(); g.roundRect(xa, y(segNote) - bh / 2, Math.max(2, xb - xa - 2 * dpr), bh, bh / 2); g.fill()
      }
      segStart = i; segNote = n
    }
  }
  // Getroffene Abschnitte + eigene Stimme
  const nowI = Math.min(ref.length - 1, Math.round(t * fps))
  for (let i = i0; i <= nowI; i++) {
    const u = user[i]
    if (!(u > 0)) continue
    const target = s.refNear(i, 4)
    const xa = x(i / fps), wd = Math.max(2, w / (span * fps) + 1)
    if (target) {
      const d = foldSemis(u - target)
      const hit = Math.abs(d) <= 1
      if (hit) { g.fillStyle = '#34d399'; g.fillRect(xa, y(Math.round(target)) - bh / 2, wd, bh) }
      else { g.fillStyle = d > 0 ? 'rgba(56,189,248,.9)' : 'rgba(255,61,129,.9)'; g.fillRect(xa, y(target + d) - 2 * dpr, wd, 4 * dpr) }
    } else {
      g.fillStyle = 'rgba(255,255,255,.35)'
      g.fillRect(xa, y(center.current + foldSemis(u - center.current)) - 2 * dpr, wd, 4 * dpr)
    }
  }
  // Jetzt-Linie und aktueller Ton
  const nx = x(t)
  g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(nx - dpr, 0, 2 * dpr, h)
  if (userNow > 0) {
    const target = s.refNear(nowI, 4)
    const base = target || center.current
    const yy = y(base + foldSemis(userNow - base))
    const hit = !!target && Math.abs(foldSemis(userNow - target)) <= 1
    g.shadowColor = hit ? '#34d399' : '#ff3d81'; g.shadowBlur = 24 * dpr
    g.fillStyle = hit ? '#34d399' : '#fff'
    g.beginPath(); g.arc(nx, Math.max(8, Math.min(h - 8, yy)), 9 * dpr, 0, Math.PI * 2); g.fill()
    g.shadowBlur = 0
  }
}
