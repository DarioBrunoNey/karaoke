// Zusatzprüfungen: Referenzmelodie der Demo gegen die echten Noten, Restpegel des Gesangs, Tempo/Tonhöhe, Mobil-Layout
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const URL = process.env.URL || 'http://localhost:4173/'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL)
await page.getByText('Ode an die Freude').first().waitFor()
await page.screenshot({ path: 'tests/shots/m1-bibliothek.png' })
await page.getByLabel('Ode an die Freude singen').click()
await page.getByTestId('mic-off').click()
await page.getByLabel('Pause').waitFor({ timeout: 30000 })
await page.waitForTimeout(6500)
await page.screenshot({ path: 'tests/shots/m2-player.png' })
// Tempo & Tonhöhe im laufenden Betrieb
const t0 = await page.evaluate(() => __encore.engine.time)
await page.getByLabel('Tempo erhöhen').click(); await page.getByLabel('Tempo erhöhen').click()
await page.getByLabel('Tonhöhe verringern').click()
await page.waitForTimeout(3000)
const t1 = await page.evaluate(() => __encore.engine.time)
console.log('Tempo 110 %: Songzeit in 3 s Echtzeit =', (t1 - t0).toFixed(2), '(erwartet ≈ 3,3)')
await page.evaluate(() => __encore.engine.seek(30)); await page.waitForTimeout(500)
console.log('Springen auf 30 s →', (await page.evaluate(() => __encore.engine.time)).toFixed(2))
// Melodie aus IndexedDB gegen die echten Noten
const mel = await page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('encore')
  r.onsuccess = () => { const g = r.result.transaction('songs').objectStore('songs').get('demo-ode'); g.onsuccess = () => res({ fps: g.result.melody.fps, src: g.result.melody.source, data: Array.from(g.result.melody.data) }) }
}))
const BEAT = 0.6
const seq = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64]
let bad = 0
const got = seq.map((m, i) => { const v = mel.data[Math.round((8 * BEAT + i * BEAT + 0.3) * mel.fps)]; if (Math.abs(v - m) > 0.5) bad++; return v.toFixed(1) })
console.log('Melodie-Quelle:', mel.src, '| erkannt:', got.join(' '), '| soll:', seq.join(' '), '| Abweichungen:', bad)
const voiced = mel.data.filter((x) => x > 0).length / mel.fps
console.log('Gesangsanteil erkannt:', voiced.toFixed(1), 's (soll ≈ 36 s) | Intro stumm:', mel.data.slice(0, 4 * mel.fps).every((x) => x === 0))
console.log('Fehler:', errors)
await browser.close()
