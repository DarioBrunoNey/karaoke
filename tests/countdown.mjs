// Prüft den Countdown vor dem ersten Einsatz am Demo-Song (erste Zeile bei 4,8 s)
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' })).newPage()
await page.goto(process.env.URL || 'http://localhost:4173/')
await page.getByLabel('Ode an die Freude singen').click()
await page.getByTestId('mic-off').click()
const seen = []
const t0 = Date.now()
while (Date.now() - t0 < 14000) {
  const s = await page.evaluate(() => { const b = document.querySelector('[data-testid=countdown]'); const e = globalThis.__encore?.engine; return b && e?.playing ? { on: b.style.opacity === '1', n: b.firstElementChild.textContent, t: e.time } : null })
  if (s?.on && !seen.some((x) => x.n === s.n)) { seen.push({ n: s.n, t: +s.t.toFixed(2) }); if (s.n === '2') await page.screenshot({ path: 'tests/shots/countdown.png' }) }
  if (s && s.t > 6) { seen.push({ nach: s.on ? 'noch sichtbar' : 'ausgeblendet', t: +s.t.toFixed(2) }); break }
  await page.waitForTimeout(60)
}
console.log(JSON.stringify(seen))
const ok = seen.length === 4 && seen[0].n === '3' && seen[1].n === '2' && seen[2].n === '1' && Math.abs(seen[0].t - 1.8) < 0.25 && Math.abs(seen[2].t - 3.8) < 0.25 && seen[3].nach === 'ausgeblendet'
console.log(ok ? '✓ Countdown 3-2-1 endet genau am Einsatz (4,8 s) und verschwindet' : '✗ Countdown stimmt nicht')
await browser.close(); process.exit(ok ? 0 : 1)
