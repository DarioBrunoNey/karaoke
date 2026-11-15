// Prüft den Mitsing-Modus gegen ein NACHGEBAUTES Spotify (Suche, Player-SDK, Liedtext-Dienst sind simuliert).
// Das testet die Logik der App – nicht das echte Verhalten von Spotify.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const URL = process.env.URL || 'http://localhost:4173/'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
const calls = []
await page.addInitScript(() => {
  localStorage.setItem('encore-settings', JSON.stringify({ spotifyClientId: 'x'.repeat(32), micAsked: true }))
  localStorage.setItem('encore-spotify-token', JSON.stringify({ access: 'tok', refresh: 'ref', exp: Date.now() + 3.6e6, clientId: 'x'.repeat(32) }))
})
const track = { id: 't1', uri: 'spotify:track:t1', name: 'Testlied', duration_ms: 14000, artists: [{ name: 'Die Tester' }], album: { name: 'Album', images: [] } }
await ctx.route('https://api.spotify.com/**', (route) => {
  const u = route.request().url(); calls.push(route.request().method() + ' ' + u.replace('https://api.spotify.com/v1', ''))
  if (u.includes('/search')) return route.fulfill({ json: { tracks: { items: [track] } } })
  if (u.includes('/me/player/play')) { return route.fulfill({ status: 204, body: '' }) }
  return route.fulfill({ status: 204, body: '' })
})
await ctx.route('https://lrclib.net/**', (route) => route.fulfill({ json: [{ id: 1, duration: 14, syncedLyrics: '[00:02.00]Erste Zeile\n[00:06.00]Zweite Zeile\n[00:10.00]Dritte Zeile', plainLyrics: 'x' }] }))
await ctx.route('https://sdk.scdn.co/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `
  window.Spotify = { Player: class {
    constructor() { this.l = {}; this.pos = 0; this.paused = true; this.t = 0 }
    addListener(n, f) { this.l[n] = f }
    emit() { this.l.player_state_changed?.({ position: this.now(), paused: this.paused, duration: 14000 }) }
    now() { return this.paused ? this.pos : Math.min(14000, this.pos + performance.now() - this.t) }
    async connect() { setTimeout(() => { this.l.ready({ device_id: 'dev1' }); this.pos = 0; this.paused = false; this.t = performance.now(); this.emit()
      this.iv = setInterval(() => { if (!this.paused && this.now() >= 14000) { this.pos = 0; this.paused = true; this.emit() } }, 100) }, 200); return true }
    async getCurrentState() { return { position: this.now(), paused: this.paused, duration: 14000 } }
    async togglePlay() { this.pos = this.now(); this.paused = !this.paused; this.t = performance.now(); this.emit() }
    async seek(ms) { this.pos = ms; this.t = performance.now(); this.emit() }
    async setVolume() {} pause() { this.paused = true } disconnect() { clearInterval(this.iv) }
  } }
  window.onSpotifyWebPlaybackSDKReady()` }))
await page.goto(URL)
await page.getByText('Spotify (Mitsingen)').click()
await page.getByPlaceholder('Bei Spotify suchen').fill('test')
await page.getByLabel('Testlied mitsingen').waitFor()
await page.screenshot({ path: 'tests/shots/s1-suche.png' })
await page.getByLabel('Testlied mitsingen').click()
await page.getByText('Erste Zeile').first().waitFor()
await page.waitForTimeout(3500)
const big = await page.locator('.lyric-fill').textContent()
await page.mouse.move(800, 400); await page.waitForTimeout(600)
await page.screenshot({ path: 'tests/shots/s2-mitsingen.png' })
await page.getByText('Applaus!').waitFor({ timeout: 20000 })
const checks = [
  ['Suche liefert Treffer', true],
  ['Wiedergabe auf dem Browser-Gerät gestartet', calls.some((c) => c.startsWith('PUT /me/player/play?device_id=dev1'))],
  ['Text läuft synchron (Zeile nach ~4 s: ' + big + ')', big === 'Erste Zeile'],
  ['Songende erkannt', true],
  ['keine Browser-Fehler', errors.length === 0],
]
for (const [n, ok] of checks) console.log(ok ? '✓' : '✗', n)
if (errors.length) console.log(errors)
await browser.close()
process.exit(checks.every((c) => c[1]) ? 0 : 1)
