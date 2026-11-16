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
  let plays = 0, lists = 0, remoteStart = 0
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(({ mode, US, NOTES }) => {
    localStorage.setItem('encore-settings', JSON.stringify({ spotifyClientId: 'x'.repeat(32), micAsked: true, micMode: 'headphones' }))
    localStorage.setItem('encore-spotify-token', JSON.stringify({ access: 'tok', refresh: 'ref', exp: Date.now() + 3.6e6, clientId: 'x'.repeat(32) }))
    if (['melodie', 'falsch', 'duell', 'handys', 'mithoeren', 'lobby', 'zaeh', 'spaeter'].includes(mode)) localStorage.setItem('encore-us4-t1', US)
    navigator.mediaDevices.getUserMedia = async (c) => {
      const aec = !!c?.audio?.echoCancellation
      window.__aec = aec
      const ac = new AudioContext()
      const osc = ac.createOscillator(); osc.type = 'sawtooth'
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
      const g = ac.createGain(); g.gain.value = 0
      const dest = ac.createMediaStreamDestination()
      osc.connect(lp).connect(g).connect(dest); osc.start()
      setInterval(() => {
        const raw = (globalThis.__spPos?.() ?? -1) / 1000
        // Duell: der zweite Sänger (Anna) singt 4 Halbtöne daneben
        const annaTurn = !!document.querySelector('[data-testid=turn]')?.textContent?.includes('Anna')
        const shift = mode === 'falsch' || (mode === 'duell' && annaTurn) ? 4 : 0
        const now = raw + 0.03
        const n = NOTES.find((x) => now >= x[0] && now < x[0] + 0.8)
        if (mode === 'mithoeren') {
          // niemand singt: das Mikrofon hört nur die Musik samt Originalgesang aus dem Lautsprecher, gleichmäßig leise
          osc.frequency.value = 440 * Math.pow(2, ((n ? n[1] : 55) - 69) / 12); g.gain.value = aec ? 0.004 : 0.12 // Echo-Unterdrückung entfernt die eigene Wiedergabe fast ganz
          return
        }
        if (n) { osc.frequency.value = 440 * Math.pow(2, (n[1] + shift - 69) / 12); g.gain.value = 0.3 } else g.gain.value = 0
      }, 5)
      return dest.stream
    }
  }, { mode, US, NOTES })
  const track = { id: 't1', uri: 'spotify:track:t1', name: 'Testlied', duration_ms: 14000, artists: [{ name: 'Die Tester' }], album: { name: 'Album', images: [] } }
  await ctx.route('https://api.spotify.com/**', (route) => {
    const u = route.request().url(); calls.push(route.request().method() + ' ' + u.replace('https://api.spotify.com/v1', ''))
    if (u.includes('/search')) return route.fulfill({ json: { tracks: { items: [track] } } })
    // Modus „ausweich": der Browser-Player wird von Spotify nie akzeptiert, aber die Spotify-App auf dem Handy ist erreichbar
    if (mode === 'ausweich') {
      if (u.includes('/me/player/devices')) return route.fulfill({ json: { devices: [{ id: 'dev1', name: 'Encore Karaoke', type: 'Computer' }, { id: 'app1', name: 'Darios Handy', type: 'Smartphone', is_active: false }] } })
      if (u.includes('/me/player/play')) {
        if (!u.includes('device_id=app1')) return route.fulfill({ status: 404, json: { error: { status: 404, message: 'Device not found' } } })
        remoteStart = Date.now(); return route.fulfill({ status: 204, body: '' })
      }
      if (/\/me\/player$/.test(u.split('?')[0]) && route.request().method() === 'GET') {
        const ms = remoteStart ? Date.now() - remoteStart : 0
        return route.fulfill({ json: { is_playing: ms < 14000, progress_ms: Math.min(14000, ms), item: { id: 't1', duration_ms: 14000 }, device: { name: 'Darios Handy' } } })
      }
    }
    // Geräteliste: im Modus „zaeh" fehlt unser Gerät beim ersten Nachsehen (wie nach Standby)
    if (u.includes('/me/player/devices')) return route.fulfill({ json: { devices: mode === 'zaeh' && (lists = (lists || 0) + 1) <= 1 ? [] : [{ id: 'dev1' }] } })
    // Modus „zaeh": Spotify kennt das Gerät zunächst nicht (wie am Handy nach längerer Pause) – die ersten Abspiel-Befehle scheitern
    if (mode === 'zaeh' && u.includes('/me/player/play') && (plays = (plays || 0) + 1) <= 4) return route.fulfill({ status: 404, json: { error: { status: 404, message: 'Device not found' } } })
    // wie beim echten Spotify beginnt die Wiedergabe erst mit dem Abspiel-Befehl – auf dem bereits angemeldeten Gerät
    if (u.includes('/me/player/play')) page.evaluate(() => window.__spStart?.()).catch(() => {})
    return route.fulfill({ status: 204, body: '' })
  })
  // Noten-Sammlung: enthält den Song nur im Modus „auto" – dort um 1,5 s verschoben (wie bei einem Musikvideo mit Vorspann)
  await ctx.route('https://raw.githubusercontent.com/**', (route) => {
    const u = route.request().url()
    if (u.endsWith('index.json')) return route.fulfill({ json: mode === 'auto' ? [{ id: 'die-tester-testlied', artist: 'Die Tester', title: 'Testlied' }, { id: 'x', artist: 'Andere', title: 'Lied' }] : [{ id: 'x', artist: 'Andere', title: 'Lied' }] })
    return route.fulfill({ contentType: 'text/plain', body: US.replace('#GAP:2000', '#GAP:3500') })
  })
  await ctx.route('https://lrclib.net/**', (route) => route.fulfill({ json: [{ id: 1, duration: 14, syncedLyrics: '[00:02.00]Erste Zeile\n[00:06.00]Zweite Zeile\n[00:10.00]Dritte Zeile', plainLyrics: 'x' }] }))
  await ctx.route('https://sdk.scdn.co/**', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    window.Spotify = { Player: class {
      constructor() { this.l = {}; this.pos = 0; this.paused = true; this.t = 0; window.__spPos = () => this.now() }
      addListener(n, f) { this.l[n] = f }
      emit() { this.l.player_state_changed?.({ position: this.now(), paused: this.paused, duration: 14000 }) }
      now() { return this.paused ? this.pos : Math.min(14000, this.pos + performance.now() - this.t) }
      async connect() { window.__spConnects = (window.__spConnects || 0) + 1; setTimeout(() => { this.l.ready({ device_id: 'dev1' })
        window.__spStart = () => { this.pos = 0; this.paused = false; this.t = performance.now(); this.emit() }
        this.iv = setInterval(() => { if (!this.paused && this.now() >= 14000) { this.pos = 0; this.paused = true; this.emit() } }, 100) }, 200); return true }
      async getCurrentState() { return { position: this.now(), paused: this.paused, duration: 14000 } }
      async togglePlay() { this.pos = this.now(); this.paused = !this.paused; this.t = performance.now(); this.emit() }
      async seek(ms) { this.pos = ms; this.t = performance.now(); this.emit() }
      async setVolume() {} pause() { this.paused = true } disconnect() { clearInterval(this.iv) }
    } }
    window.onSpotifyWebPlaybackSDKReady()` }))
  await page.goto(URL + (['handys', 'lobby', 'spaeter'].includes(mode) ? '?bc' : ''))
  if (mode === 'duell') {
    await page.getByRole('button', { name: 'Karaoke-Abend' }).first().click()
    await page.getByText('Jemand ohne Handy?').click()
    await page.getByPlaceholder('Name hinzufügen').fill('Anna')
    await page.getByRole('button', { name: 'Hinzufügen' }).click()
    await page.getByRole('button', { name: 'Bibliothek' }).first().click()
  }
  if (mode === 'lobby') {
    // Der einfache Weg: Lobby öffnen → Handys scannen den Code → „Song aussuchen" → alle singen automatisch gleichzeitig
    await page.getByRole('button', { name: 'Karaoke-Abend starten' }).click()
    const url = await page.getByTestId('phone-url').textContent({ timeout: 8000 })
    const join = async (name, midi) => {
      const ph = await ctx.newPage()
      ph.on('pageerror', (e) => errors.push('Handy: ' + e))
      await ph.addInitScript((midi) => {
        navigator.mediaDevices.getUserMedia = async () => {
          const ac = new AudioContext(); const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12)
          const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
          const g = ac.createGain(); g.gain.value = 0.3; const d = ac.createMediaStreamDestination(); o.connect(lp).connect(g).connect(d); o.start(); return d.stream
        }
      }, midi)
      await ph.addInitScript(() => localStorage.removeItem('encore-phone-name')) // jedes Test-Handy ist ein „neues" Gerät
      await ph.setViewportSize({ width: 390, height: 780 })
      await ph.goto(url)
      await ph.screenshot({ path: 'tests/shots/l1-handy-start.png' })
      await ph.getByPlaceholder('Dein Name').fill(name)
      await ph.getByTestId('phone-start').click()
      await ph.getByTestId('phone-state').waitFor()
      return ph
    }
    const pa = await join('Anna', 60); const pb = await join('Ben', 64)
    // Ben schließt die Seite und öffnet sie wieder: ein Tipp genügt, kein neuer Name, kein doppelter Eintrag
    await pb.close()
    const back = await ctx.newPage()
    await back.addInitScript(() => { navigator.mediaDevices.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 329.63; const g = ac.createGain(); g.gain.value = 0.3; const d = ac.createMediaStreamDestination(); o.connect(g).connect(d); o.start(); return d.stream } })
    await back.setViewportSize({ width: 390, height: 780 })
    await back.goto(url)
    const welcome = await back.getByText('Willkommen zurück').count()
    await back.screenshot({ path: 'tests/shots/l4-handy-zurueck.png' })
    await back.getByTestId('phone-continue').click()
    await back.getByTestId('phone-state').waitFor()
    const rejoin = welcome ? 'ok' : 'kein Willkommen-zurück'
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=phone-chip]').length === 2, null, { timeout: 8000 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: 'tests/shots/l2-lobby.png' })
    await page.getByTestId('pick-song').click()
    await page.getByPlaceholder('Bei Spotify suchen').fill('test')
    await page.getByLabel('Testlied mitsingen').click()
    await page.getByTestId('lane-Ben').waitFor({ timeout: 15000 })
    const phoneSays = await pa.waitForFunction(() => document.querySelector('[data-testid=phone-state]')?.textContent === 'Du singst!', null, { timeout: 8000 }).then(() => 'Du singst!').catch(() => 'keine Meldung')
    await pa.screenshot({ path: 'tests/shots/l3-handy-singt.png' })
    const micDialog = await page.getByTestId('mic-headphones').count()
    await page.getByTestId('rank-2').waitFor({ timeout: 30000 })
    const own = await pa.getByTestId('phone-result').textContent({ timeout: 5000 }).catch(() => '')
    await pa.screenshot({ path: 'tests/shots/l5-handy-ergebnis.png' })
    const out = { mode, total: +(await page.getByTestId('rank-1').locator('.grad-text').textContent()), pitch: +(await page.getByTestId('rank-2').locator('.grad-text').textContent()), state: phoneSays, note: micDialog ? 'Mikrofon-Dialog erschien' : !/Platz [12] von 2/.test(own) ? 'keine Auswertung am Handy' : rejoin, errors, played: true }
    await ctx.close()
    return out
  }
  await page.getByText('Spotify (Mitsingen)').click()
  await page.getByPlaceholder('Bei Spotify suchen').fill('test')
  if (shot === 's4') { await page.getByLabel('Testlied mitsingen').waitFor(); await page.waitForTimeout(500); await page.screenshot({ path: 'tests/shots/n1-suche.png' }) }
  await page.getByLabel('Testlied mitsingen').click()
  if (mode !== 'ausweich') await page.getByText('Erste Zeile').first().waitFor()
  if (mode === 'duell') {
    await page.mouse.move(700, 300)
    await page.getByTestId('mode').click()
    await page.getByTestId('pl-Anna').click()
    await page.getByTestId('style-duel').click()
    await page.getByTestId('sec-0').click()
    await page.screenshot({ path: 'tests/shots/s6-modus.png' })
    await page.getByTestId('mode-start').click()
    const t1 = await page.getByTestId('turn').textContent()
    await page.waitForFunction(() => document.querySelector('[data-testid=turn]')?.textContent?.includes('Anna'), null, { timeout: 25000 })
    await page.waitForTimeout(4500); await page.mouse.move(800, 320); await page.waitForTimeout(400)
    await page.screenshot({ path: 'tests/shots/s6-duell.png' })
    await page.getByTestId('rank-1').waitFor({ timeout: 30000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: 'tests/shots/s6-ergebnis.png' })
    const r1 = await page.getByTestId('rank-1').textContent(), r2 = await page.getByTestId('rank-2').textContent()
    const pts = async (id) => +(await page.getByTestId(id).locator('.grad-text').textContent())
    const out = { mode, total: await pts('rank-1'), pitch: await pts('rank-2'), state: (t1.includes('Sänger 1') ? 'erst Sänger 1, dann Anna' : t1) + ' | Sieger: ' + (r1.includes('Sänger 1') ? 'Sänger 1' : 'Anna'), errors, played: true }
    await ctx.close()
    return out
  }
  if (mode === 'handys') {
    // Zwei simulierte Handys verbinden sich über den Link aus dem QR-Code; jedes „singt" einen Dauerton
    await page.mouse.move(700, 300)
    await page.getByTestId('mode').click()
    await page.getByTestId('phones-start').click()
    const url = await page.getByTestId('phone-url').textContent()
    const phone = async (name, midi) => {
      const ph = await ctx.newPage()
      ph.on('pageerror', (e) => errors.push('Handy: ' + e))
      await ph.addInitScript((midi) => {
        navigator.mediaDevices.getUserMedia = async () => {
          const ac = new AudioContext(); const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12)
          const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
          const g = ac.createGain(); g.gain.value = 0.3; const d = ac.createMediaStreamDestination(); o.connect(lp).connect(g).connect(d); o.start(); return d.stream
        }
      }, midi)
      await ph.addInitScript(() => localStorage.removeItem('encore-phone-name')) // jedes Test-Handy ist ein „neues" Gerät
      await ph.setViewportSize({ width: 390, height: 780 })
      await ph.goto(url)
      await ph.getByPlaceholder('Dein Name').fill(name)
      await ph.getByTestId('phone-start').click()
      await ph.getByTestId('phone-state').waitFor()
      return ph
    }
    const pa = await phone('Anna', 60), pb = await phone('Ben', 64)
    await page.waitForFunction(() => document.querySelectorAll('[data-testid=phone-chip]').length === 2, null, { timeout: 8000 })
    await pa.waitForTimeout(600)
    await pa.screenshot({ path: 'tests/shots/s7-handy.png' })
    await page.screenshot({ path: 'tests/shots/s7-verbinden.png' })
    await page.getByTestId('pl-Anna').click(); await page.getByTestId('pl-Ben').click(); await page.getByTestId('pl-Sänger 1').click()
    await page.getByTestId('style-simul').click()
    await page.getByTestId('mode-start').click()
    await page.getByTestId('lane-Ben').waitFor()
    await page.waitForFunction(() => +document.querySelector('[data-testid="score-Anna"]')?.textContent > 0 && +document.querySelector('[data-testid="score-Ben"]')?.textContent > 0, null, { timeout: 12000 }).catch(() => {})
    await page.mouse.move(800, 200); await page.waitForTimeout(400)
    const noteA = await page.getByTestId('lane-Anna').locator('.font-mono').textContent({ timeout: 2000 }).catch(() => '')
    const noteB = await page.getByTestId('lane-Ben').locator('.font-mono').textContent({ timeout: 2000 }).catch(() => '')
    await page.screenshot({ path: 'tests/shots/s7-gleichzeitig.png' })
    await page.getByTestId('rank-2').waitFor({ timeout: 30000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: 'tests/shots/s7-ergebnis.png' })
    const pts = async (id) => +(await page.getByTestId(id).locator('.grad-text').textContent())
    const names = (await page.getByTestId('rank-1').textContent()).includes('Anna') || (await page.getByTestId('rank-1').textContent()).includes('Ben')
    const out = { mode, total: await pts('rank-1'), pitch: await pts('rank-2'), state: `Anna singt ${noteA}, Ben singt ${noteB}`, note: names ? 'ok' : 'falsche Namen', errors, played: true }
    await ctx.close()
    return out
  }
  if (mode === 'spaeter') {
    // Song läuft schon; über „Mikrofon" den QR-Code holen, ein Handy verbindet sich – dessen Besitzer singt sofort weiter
    await page.mouse.move(700, 300)
    await page.getByTestId('settings').click()
    await page.getByRole('button', { name: 'Ändern' }).last().click().catch(() => {})
    let url = await page.getByTestId('phone-url').textContent({ timeout: 3000 }).catch(() => '')
    if (!url) { await page.getByText('Mikrofon').first().click().catch(() => {}); url = await page.getByTestId('phone-url').textContent({ timeout: 3000 }) }
    await page.waitForTimeout(700)
    await page.screenshot({ path: 'tests/shots/m1-mikrofon-dialog.png' })
    const ph = await ctx.newPage()
    await ph.addInitScript(() => {
      localStorage.removeItem('encore-phone-name')
      navigator.mediaDevices.getUserMedia = async () => { const ac = new AudioContext(); const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 261.63; const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; const g = ac.createGain(); g.gain.value = 0.3; const d = ac.createMediaStreamDestination(); o.connect(lp).connect(g).connect(d); o.start(); return d.stream }
    })
    await ph.goto(url)
    await ph.getByPlaceholder('Dein Name').fill('Cara')
    await ph.getByTestId('phone-start').click()
    const lane = await page.getByTestId('lane-Cara').waitFor({ timeout: 8000 }).then(() => 'ok').catch(() => 'keine Bahn für Cara')
    const dialogGone = (await page.getByTestId('phone-url').count()) === 0
    const says = await ph.waitForFunction(() => document.querySelector('[data-testid=phone-state]')?.textContent === 'Du singst!', null, { timeout: 6000 }).then(() => 'ok').catch(() => 'Handy weiß nichts')
    const out = { mode, total: 0, pitch: 0, state: lane, note: dialogGone ? says : 'Dialog blieb offen', errors, played: true }
    await ctx.close()
    return out
  }
  if (mode === 'ausweich') {
    const t0 = Date.now()
    const line = await page.getByText('Zweite Zeile').first().waitFor({ timeout: 25000 }).then(() => 'ok').catch(() => 'kein Text')
    const secs = Math.round((Date.now() - t0) / 1000)
    const toast = await page.getByText('Darios Handy').count()
    const out = { mode, total: secs, pitch: 0, state: line, note: calls.some((c) => c.includes('device_id=app1')) ? 'ok' : 'nicht ausgewichen', errors, played: true }
    await ctx.close()
    return out
  }
  const want = mode === 'frei' ? 'Stimme erkannt' : mode === 'falsch' ? 'Zu hoch' : mode === 'mithoeren' ? 'Sing!' : 'Treffer'
  const state = await page.waitForFunction((w) => document.querySelector('[data-testid=live-state]')?.textContent === w, want, { timeout: 9000 }).then(() => want).catch(() => 'nie: ' + want)
  const note = await page.getByTestId('live-note').textContent({ timeout: 500 }).catch(() => '')
  if (shot) { await page.mouse.move(800, 300); await page.waitForTimeout(500); await page.screenshot({ path: `tests/shots/${shot}-singen.png` }) }
  if (shot === 's4') { await page.getByTestId('settings').click(); await page.waitForTimeout(400); await page.screenshot({ path: 'tests/shots/n2-einstellungen.png' }); await page.keyboard.press('Escape') }
  await page.getByTestId('total').waitFor({ timeout: 20000 })
  await page.waitForTimeout(700)
  if (shot) await page.screenshot({ path: `tests/shots/${shot}-auswertung.png` })
  const num = async (id) => +(await page.getByTestId(id).textContent()).replace(/\D.*$/, '')
  const aecOn = await page.evaluate(() => window.__aec)
  const reconnects = await page.evaluate(() => window.__spConnects)
  const res = { mode, total: await num('total'), pitch: await num('part-pitch'), rhythm: await num('part-rhythm'), timing: await num('part-timing'), continuity: await num('part-continuity'), state, note, again: '', aecOn, reconnects, errors, played: calls.some((c) => c.startsWith('PUT /me/player/play?device_id=dev1')) }
  if (mode === 'melodie') {
    // zweiter Song in derselben Sitzung: der Spotify-Player wird wiederverwendet, nicht neu angemeldet
    await page.getByRole('button', { name: 'Nochmal' }).click()
    res.again = await page.waitForFunction(() => document.querySelector('[data-testid=live-state]')?.textContent === 'Treffer', null, { timeout: 12000 }).then(() => 'ok').catch(() => 'kein zweiter Start')
    if ((await page.evaluate(() => window.__spConnects)) !== 1) res.again = 'Player wurde neu angemeldet'
  }
  await ctx.close()
  return res
}

const results = await Promise.all([run('frei', 's3'), run('melodie', 's4'), run('falsch'), run('auto', 's5'), run('duell'), run('handys'), run('mithoeren'), run('lobby'), run('zaeh'), run('spaeter'), run('ausweich')])
console.table(results.map(({ errors, ...r }) => r))
const by = Object.fromEntries(results.map((r) => [r.mode, r]))
const checks = [
  ['Wiedergabe gestartet', results.every((r) => r.played)],
  ['ohne Melodie: Stimme sichtbar + plausible Punkte (≥ 70)', by.frei.state === 'Stimme erkannt' && by.frei.total >= 70],
  ['mit Melodie-Datei: richtiger Sänger ≥ 85', by.melodie.total >= 85 && by.melodie.state === 'Treffer'],
  ['mit Melodie-Datei: falsche Tonart → Tonhöhe ≤ 15 und „Zu hoch"', by.falsch.pitch <= 15 && by.falsch.state === 'Zu hoch'],
  ['Noten automatisch gefunden und ausgerichtet (1,5 s Versatz): Sänger ≥ 80', by.auto.total >= 80 && by.auto.state === 'Treffer'],
  ['Duell über eine Strophe: richtiger Sänger gewinnt (≥ 80), der schiefe verliert (≤ 50)', by.duell.total >= 80 && by.duell.pitch <= 50 && by.duell.state.endsWith('Sänger 1')],
  ['Zwei Handy-Mikrofone gleichzeitig: beide Stimmen kommen getrennt an (C4 / E4), beide bekommen Punkte', by.handys.state === 'Anna singt C4, Ben singt E4' && by.handys.total > 0 && by.handys.pitch > 0 && by.handys.note === 'ok'],
  ['Niemand singt, Mikrofon hört laut den Originalsänger aus dem eigenen Lautsprecher: App schaltet auf Echo-Unterdrückung, keine Punkte (≤ 10)', by.mithoeren.total <= 10 && by.mithoeren.aecOn === true],
  ['Mit Kopfhörern bleibt das Mikrofon unbearbeitet', by.melodie.aecOn === false],
  ['Zweiter Song direkt danach startet ohne neue Anmeldung', by.melodie.again === 'ok'],
  ['Lobby: zwei Handys scannen, Song wählen – beide singen automatisch gleichzeitig, Handy zeigt „Du singst!"', by.lobby.state === 'Du singst!' && by.lobby.note === 'ok' && by.lobby.total > 0],
  ['Spotify kennt das Gerät erst nicht: App meldet den Player neu an und startet trotzdem', by.zaeh.total >= 80 && by.zaeh.reconnects >= 2],
  ['Handy verbindet sich mitten im Song über den Mikrofon-Dialog: sein Besitzer singt sofort weiter', by.spaeter.state === 'ok' && by.spaeter.note === 'ok'],
  ['Browser-Player kommt nicht zustande: App weicht von selbst auf die Spotify-App aus (nach ' + by.ausweich.total + ' s läuft der Text)', by.ausweich.state === 'ok' && by.ausweich.note === 'ok' && by.ausweich.total <= 20],
  ['keine Browser-Fehler', results.every((r) => r.errors.length === 0)],
]
for (const [n, ok] of checks) console.log(ok ? '✓' : '✗', n)
for (const r of results) if (r.errors.length) console.log(r.mode, r.errors.slice(0, 3))
await browser.close()
process.exit(checks.every((c) => c[1]) ? 0 : 1)
