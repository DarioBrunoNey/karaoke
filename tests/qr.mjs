// Prüft den QR-Scanner: Die „Kamera" zeigt einen echten QR-Code der App (als Videodatei eingespeist).
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const QR = require('/home/user/karaoke/node_modules/qrcode')
const URL = process.env.URL || 'http://localhost:4173/'
const dir = fs.mkdtempSync('/tmp/claude-0/-home-user/17dbf16b-a9b5-5c1f-b18b-ba354d281bd8/scratchpad/qr-')
// 1) Kamerabild erzeugen: QR-Code mit Mikrofon-Link, etwas schräg und nicht bildfüllend wie von Hand gehalten
const data = await QR.toDataURL('https://karaoke.example/?mic=abc234', { margin: 2, width: 300 })
const b0 = await chromium.launch()
const p0 = await b0.newPage({ viewport: { width: 640, height: 480 } })
await p0.setContent(`<body style="margin:0;background:#445;display:flex;align-items:center;justify-content:center;height:480px"><img src="${data}" style="width:260px;transform:rotate(6deg)"></body>`)
const jpg = await p0.screenshot({ type: 'jpeg', quality: 85 })
await b0.close()
fs.writeFileSync(dir + '/cam.mjpeg', Buffer.concat(Array(30).fill(jpg)))
// 2) App am „Handy" öffnen und scannen
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${dir}/cam.mjpeg`] })
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 }, serviceWorkers: 'block' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(URL)
await page.getByTestId('scan-open').click()
await page.getByTestId('scan-msg').waitFor()
await page.waitForTimeout(900)
await page.screenshot({ path: 'tests/shots/q1-scanner.png' }).catch(() => {})
const ok = await page.waitForURL(/[?&]mic=abc234/, { timeout: 15000 }).then(() => true).catch(() => false)
const onMicPage = ok && (await page.getByText('Mikrofon').first().isVisible().catch(() => false))
console.log(ok && onMicPage ? '✓ QR-Code erkannt, Handy landet auf der Mikrofon-Seite mit dem richtigen Code' : '✗ QR-Code nicht erkannt (' + page.url() + ')')
console.log('Erkennung über:', await page.evaluate(() => ('BarcodeDetector' in window ? 'Browser' : 'mitgelieferte Bibliothek')), '| Fehler:', errors.length)
await browser.close()
process.exit(ok && onMicPage && !errors.length ? 0 : 1)
