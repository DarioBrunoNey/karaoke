// Prüft den Spotify-Modus gegen ein NACHGEBAUTES Spotify (Suche, Player-SDK, Liedtext-Dienst sind simuliert),
// mit einem künstlichen Sänger als Mikrofon. Das testet die Logik der App – nicht das echte Verhalten von Spotify.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const URL = process.env.URL || 'http://localhost:4173/'
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] })

const US = `#TITLE:Testlied\n#ARTIST:Die Tester\n#BPM:150\n#GAP:2000\n: 0 8 0 Ers\n: 10 8 2 te\n: 20 8 4  Zeile\n- 38\n: 40 8 5 Zwei\n: 50 8 4 te\n: 60 8 2  Zeile\n- 78\n: 80 8 0 Drit\n: 90 8 2 te\n: 100 8 0  Zeile\nE\n`
const NOTES = [[2, 60], [3, 62], [4, 64], [6, 65], [7, 64], [8, 62], [10, 60], [11, 62], [12, 60]]

async function run(mode, shot) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = [], calls = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(({ mode, US, NOTES }) => {
    localStorage.setItem('encore-settings', JSON.stringify({ spotifyClientId: 'x'.repeat(32), micAsked: true, micMode: 'headphones' }))
    localStorage.setItem('encore-spotify-token', JSON.stringify({ access: 'tok', refresh: 'ref', exp: Date.now() + 3.6e6, clientId: 'x'.repeat(32) }))
    if (mode !== 'frei') localStorage.setItem('encore-us-t1', US)
    navigator.mediaDevices.getUserMedia = async () => {
      const ac = new AudioContext()
      const osc = ac.createOscillator(); osc.type = 'sawtooth'
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
      const g = ac.createGain(); g.gain.value = 0
      const dest = ac.createMediaStreamDestination()
      osc.connect(lp).connect(g).connect(dest); osc.start()
      const shift = mode === 'falsch' ? 4 : 0
      setInterval(() => {
        const now = (globalThis.__spPos?.() ?? -1) / 1000 + 0.03
        const n = NOTES.find((x) => now >= x[0] && now < x[0] + 0.8)
        if (n) { osc.frequency.value = 440 * Math.pow(2, (n[1] + shift - 69) / 12); g.gain.value = 0.3 } else g.gain.value = 0
      }, 5)
      return dest.stream
    }
  }, { mode, US, NOTES })
  const track = { id: 't1', uri: 'spotify:track:t1', name: 'Testlied', duration_ms: 14000, artists: [{ name: 'Die Tester' }], album: { name: 'Album', images: [] } }
  await ctx.route('https://api.spotify.com/**', (route) => {
    const u = route.request().url(); calls.push(route.request().method() + ' ' + u.replace('https://api.spotify.com/v1', ''))
    if (u.includes('/search')) return route.fulfill({ json: { tracks: { items: [track] } } })
    return route.fulfill({ status: 204, body: '' })
  })
  await ctx.route('https://lrclib.net/**', (route) => route.fulfill({ json: [{ id: 1, duration: 14, syncedLyrics: '[00:02.00]Erste Zeile\n[00:06.00]Zweite Zeile\n[00:10.00]Dritte Zeile', plainLyrics: 'x' }] }))
  await ctx.route('https://sdk.scdn.co/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    window.Spotify = { Player: class {
      constructor() { this.l = {}; this.pos = 0; this.paused = true; this.t = 0; window.__spPos = () => this.now() }
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
  await page.getByLabel('Testlied mitsingen').click()
  await page.getByText('Erste Zeile').first().waitFor()
  const want = mode === 'frei' ? 'Stimme erkannt' : mode === 'melodie' ? 'Treffer' : 'Zu hoch'
  const state = await page.waitForFunction((w) => document.querySelector('[data-testid=live-state]')?.textContent === w, want, { timeout: 9000 }).then(() => want).catch(() => 'nie: ' + want)
  const note = await page.getByTestId('live-note').textContent({ timeout: 500 }).catch(() => '')
  if (shot) { await page.mouse.move(800, 300); await page.waitForTimeout(500); await page.screenshot({ path: `tests/shots/${shot}-singen.png` }) }
  await page.getByTestId('total').waitFor({ timeout: 20000 })
  await page.waitForTimeout(700)
  if (shot) await page.screenshot({ path: `tests/shots/${shot}-auswertung.png` })
  const num = async (id) => +(await page.getByTestId(id).textContent()).replace(/\D.*$/, '')
  const res = { mode, total: await num('total'), pitch: await num('part-pitch'), rhythm: await num('part-rhythm'), timing: await num('part-timing'), continuity: await num('part-continuity'), state, note, errors, played: calls.some((c) => c.startsWith('PUT /me/player/play?device_id=dev1')) }
  await ctx.close()
  return res
}

const results = await Promise.all([run('frei', 's3'), run('melodie', 's4'), run('falsch')])
console.table(results.map(({ errors, ...r }) => r))
const by = Object.fromEntries(results.map((r) => [r.mode, r]))
const checks = [
  ['Wiedergabe gestartet', results.every((r) => r.played)],
  ['ohne Melodie: Stimme sichtbar + plausible Punkte (≥ 70)', by.frei.state === 'Stimme erkannt' && by.frei.total >= 70],
  ['mit Melodie-Datei: richtiger Sänger ≥ 85', by.melodie.total >= 85 && by.melodie.state === 'Treffer'],
  ['mit Melodie-Datei: falsche Tonart → Tonhöhe ≤ 15 und „Zu hoch"', by.falsch.pitch <= 15 && by.falsch.state === 'Zu hoch'],
  ['keine Browser-Fehler', results.every((r) => r.errors.length === 0)],
]
for (const [n, ok] of checks) console.log(ok ? '✓' : '✗', n)
for (const r of results) if (r.errors.length) console.log(r.mode, r.errors.slice(0, 3))
await browser.close()
process.exit(checks.every((c) => c[1]) ? 0 : 1)
