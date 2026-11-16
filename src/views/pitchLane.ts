import { foldSemis } from '../lib/pitch'
import type { ScoreSession } from '../lib/scoring'

/** Eine Textzeile als „Seite" der Notenanzeige: Start und Ende des Gesangs in Sekunden */
export interface LanePage { t: number; e: number }

interface Run { kind: 'hit' | 'high' | 'low' | 'free'; y: number; x0: number; x1: number }

/**
 * Notenanzeige im Stil klassischer Karaoke-Spiele: Je Textzeile eine feste Seite mit den Noten als leere Röhren.
 * Triffst du die Stimmlage, füllt sich die Röhre farbig; liegst du daneben, erscheint dein Ton als schmaler Balken
 * darüber (zu hoch) oder darunter (zu tief). Die Oktave spielt keine Rolle.
 */
export function drawLane(cv: HTMLCanvasElement | null, s: ScoreSession, t: number, center: { current: number }, userNow: number, pages?: LanePage[]) {
  if (!cv) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = cv.clientWidth * dpr, h = cv.clientHeight * dpr
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h }
  const g = cv.getContext('2d')!
  g.clearRect(0, 0, w, h)
  const fps = s.fps, ref = s.ref, user = s.user

  // Seite bestimmen: aktuelle Zeile; nach ihrem Ende schon die nächste als Vorschau
  let a: number, b: number
  if (pages && pages.length) {
    let i = 0
    while (i + 1 < pages.length && t >= pages[i + 1].t - 0.25) i++
    if (i + 1 < pages.length && t > pages[i].e + 0.8) i++
    a = pages[i].t - 0.25
    const nextStart = pages[i + 1] ? pages[i + 1].t - 0.3 : Infinity
    b = Math.max(pages[i].e + 0.1, Math.min(Math.max(pages[i].e + 0.25, a + 3.2), nextStart))
  } else {
    a = t - 1.8; b = a + 6
  }
  const pad = 28 * dpr
  const x = (time: number) => pad + ((time - a) / (b - a)) * (w - 2 * pad)
  const i0 = Math.max(0, Math.floor(a * fps)), i1 = Math.min(ref.length - 1, Math.ceil(b * fps))

  // Tonbereich an die Noten der Seite anpassen
  let lo = 999, hi = -999
  for (let i = i0; i <= i1; i++) if (ref[i] > 0) { lo = Math.min(lo, ref[i]); hi = Math.max(hi, ref[i]) }
  const hasRef = hi > 0
  if (!hasRef && userNow > 0) center.current += (center.current + foldSemis(userNow - center.current) - center.current) * 0.02
  const mid = hasRef ? (lo + hi) / 2 : center.current
  const span = hasRef ? Math.max(12, hi - lo + 7) : 16
  const row = h / span
  const bh = Math.max(9 * dpr, Math.min(26 * dpr, row * 1.7))
  const y = (m: number) => Math.max(bh / 2 + 2, Math.min(h - bh / 2 - 2, h / 2 - (m - mid) * row))
  const rr = (x0: number, yc: number, wd: number, ht: number) => { g.beginPath(); g.roundRect(x0, yc - ht / 2, Math.max(ht * 0.6, wd), ht, ht / 2) }

  // Notenlinien
  g.fillStyle = 'rgba(255,255,255,.05)'
  for (let k = 1; k < 6; k++) g.fillRect(0, (h * k) / 6, w, dpr)

  // Referenz: leere Röhren
  let segStart = -1, segNote = 0
  for (let i = i0; i <= i1 + 1; i++) {
    const n = i <= i1 && ref[i] > 0 ? Math.round(ref[i]) : 0
    if (n !== segNote) {
      if (segNote) {
        const xa = x(segStart / fps), xb = x(i / fps)
        rr(xa, y(segNote), xb - xa - 3 * dpr, bh)
        g.fillStyle = 'rgba(255,255,255,.09)'; g.fill()
        g.lineWidth = 1.5 * dpr; g.strokeStyle = 'rgba(255,255,255,.38)'; g.stroke()
      }
      segStart = i; segNote = n
    }
  }

  // Eigene Stimme bis jetzt: zusammenhängende Abschnitte sammeln
  const nowI = Math.min(i1, Math.round(t * fps))
  const runs: Run[] = []
  let cur: Run | null = null
  for (let i = i0; i <= nowI; i++) {
    const u = user[i]
    let kind: Run['kind'] | null = null, yy = 0
    if (u > 0) {
      const target = s.refNear(i, 4)
      if (target) {
        const d = foldSemis(u - target)
        if (Math.abs(d) <= s.tol.hit) { kind = 'hit'; yy = y(Math.round(target)) }
        else { kind = d > 0 ? 'high' : 'low'; yy = y(Math.round(target) + Math.round(d)) }
      } else { kind = 'free'; yy = y(Math.round(mid + foldSemis(u - mid))) }
    }
    const xa = x(i / fps), xb = x((i + 1) / fps)
    if (kind && cur && cur.kind === kind && Math.abs(cur.y - yy) < 1 && xa - cur.x1 < 3 * dpr) cur.x1 = xb
    else { cur = kind ? { kind, y: yy, x0: xa, x1: xb } : null; if (cur) runs.push(cur) }
  }
  for (const r of runs) {
    const wd = r.x1 - r.x0
    if (r.kind === 'hit' || (r.kind === 'free' && !hasRef)) {
      rr(r.x0, r.y, wd - 3 * dpr, bh)
      const grad = g.createLinearGradient(0, r.y - bh / 2, 0, r.y + bh / 2)
      if (r.kind === 'hit') { grad.addColorStop(0, '#7dffc8'); grad.addColorStop(0.5, '#22d3a0'); grad.addColorStop(1, '#0f9f78') }
      else { grad.addColorStop(0, '#ff8fb8'); grad.addColorStop(0.5, '#c264f5'); grad.addColorStop(1, '#6d5df0') }
      g.shadowColor = r.kind === 'hit' ? 'rgba(52,211,153,.7)' : 'rgba(168,85,247,.6)'; g.shadowBlur = 14 * dpr
      g.fillStyle = grad; g.fill(); g.shadowBlur = 0
      // Glanzlicht
      rr(r.x0 + bh * 0.2, r.y - bh * 0.22, wd - 3 * dpr - bh * 0.4, bh * 0.22)
      g.fillStyle = 'rgba(255,255,255,.35)'; g.fill()
    } else {
      rr(r.x0, r.y, wd - 2 * dpr, bh * 0.5)
      g.fillStyle = r.kind === 'high' ? 'rgba(56,189,248,.85)' : r.kind === 'low' ? 'rgba(255,61,129,.85)' : 'rgba(255,255,255,.3)'
      g.fill()
    }
  }

  // Zeiger und aktueller Ton
  const nx = Math.max(pad * 0.5, Math.min(w - pad * 0.5, x(t)))
  const lg = g.createLinearGradient(0, 0, 0, h)
  lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,.75)'); lg.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = lg; g.fillRect(nx - dpr, 0, 2 * dpr, h)
  if (userNow > 0) {
    const target = s.refNear(Math.min(ref.length - 1, Math.max(0, Math.round(t * fps))), 4)
    const base = target || mid
    const d = foldSemis(userNow - base)
    const hit = !!target && Math.abs(d) <= s.tol.hit
    g.shadowColor = hit ? '#34d399' : target ? '#ff3d81' : '#c264f5'; g.shadowBlur = 22 * dpr
    g.fillStyle = hit ? '#7dffc8' : '#fff'
    g.beginPath(); g.arc(nx, y(base + d), Math.max(7 * dpr, bh * 0.42), 0, Math.PI * 2); g.fill()
    g.shadowBlur = 0
  }
}
