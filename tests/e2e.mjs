// End-to-End-Test im echten Browser: Ein synthetischer „Sänger" wird als Mikrofon eingespeist.
// Aufruf: npm run build && npx vite preview --port 4173 &   dann: node tests/e2e.mjs
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright') // global installiert: NODE_PATH=$(npm root -g)

const URL = process.env.URL || 'http://localhost:4173/'
const SHOTS = process.env.SHOTS || 'tests/shots'

const fakeMic = (mode) => {
  const BEAT = 0.6, INTRO = 8 * BEAT
  const A1 = [[64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1]]
  const A2 = [[60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2]]
  const A4 = [[60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2]]
  const notes = []
  let t = INTRO
  for (let v = 0; v < 2; v++) for (const [m, b] of [...A1, ...A2, ...A1, ...A4]) { notes.push({ t, e: t + b * BEAT - 0.06, m }); t += b * BEAT }
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
    const g = ctx.createGain(); g.gain.value = 0
    const dest = ctx.createMediaStreamDestination()
    osc.connect(lp).connect(g).connect(dest); osc.start()
    const shift = mode === 'wrong' ? 4 : mode === 'octave' ? -12 : 0
    setInterval(() => {
      const eng = globalThis.__encore?.engine
      if (!eng || !eng.playing || mode === 'silent') { g.gain.value = 0; return }
      const now = eng.time + 0.03
      const n = notes.find((x) => now >= x.t && now < x.e)
      if (n) { osc.frequency.value = 440 * Math.pow(2, (n.m + shift - 69) / 12); g.gain.value = 0.3 } else g.gain.value = 0
    }, 5)
    return dest.stream
  }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] })

async function run(mode, shots) {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.addInitScript(fakeMic, mode)
  await page.goto(URL)
  await page.getByText('Ode an die Freude').first().waitFor()
  if (shots) await page.screenshot({ path: `${SHOTS}/1-bibliothek.png` })
  await page.getByLabel('Ode an die Freude singen').click()
  if (shots) { await page.getByTestId('mic-headphones').waitFor(); await page.screenshot({ path: `${SHOTS}/2-mikrofon.png` }) }
  await page.getByTestId('mic-headphones').click()
  await page.getByTestId('live-score').waitFor({ timeout: 30000 })
  if (shots) {
    await page.waitForTimeout(13000)
    await page.mouse.move(900, 500); await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/3-player.png` })
  }
  await page.getByTestId('total').waitFor({ timeout: 90000 })
  await page.waitForTimeout(2600)
  const num = async (id) => +(await page.getByTestId(id).textContent())
  const res = { mode, total: await num('total'), accuracy: await num('accuracy'), pitch: await num('part-pitch'), rhythm: await num('part-rhythm'), timing: await num('part-timing'), continuity: await num('part-continuity'), errors }
  if (shots) await page.screenshot({ path: `${SHOTS}/4-auswertung.png` })
  await ctx.close()
  return res
}

const results = await Promise.all([run('perfect', true), run('octave'), run('wrong'), run('silent')])
console.table(results.map(({ errors, ...r }) => r))
const by = Object.fromEntries(results.map((r) => [r.mode, r]))
const checks = [
  ['perfekter Sänger ≥ 85', by.perfect.total >= 85],
  ['Oktave tiefer ≥ 85', by.octave.total >= 85],
  ['falsche Tonart: Tonhöhe ≤ 15', by.wrong.pitch <= 15],
  ['stumm = 0', by.silent.total === 0],
  ['keine Browser-Fehler', results.every((r) => r.errors.length === 0)],
]
for (const [n, ok] of checks) console.log(ok ? '✓' : '✗', n)
for (const r of results) if (r.errors.length) console.log(r.mode, r.errors.slice(0, 5))
await browser.close()
process.exit(checks.every((c) => c[1]) ? 0 : 1)
