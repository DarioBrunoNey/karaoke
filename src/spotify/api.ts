// Spotify-Anbindung für den Mitsing-Modus – ausschließlich offizielle Wege:
// Anmeldung per OAuth (PKCE, ohne Geheimnis), Wiedergabe über das Web Playback SDK bzw. Spotify Connect.
// Die App steuert nur die Wiedergabe; auf das Audiosignal gibt es keinen Zugriff (und es wird keiner versucht).
import type { LyricLine, SpTrack } from '../lib/types'
import { parseLrc } from '../lib/lrc.ts'

const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative'
const TOKEN_KEY = 'encore-spotify-token'
const PKCE_KEY = 'encore-spotify-pkce'

interface Token { access: string; refresh: string; exp: number; clientId: string }

export const redirectUri = () => location.origin + location.pathname

const b64url = (buf: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function readToken(): Token | null {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') } catch { return null }
}
export const isConnected = () => !!readToken()
export const disconnect = () => localStorage.removeItem(TOKEN_KEY)

export async function startLogin(clientId: string) {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  const state = b64url(crypto.getRandomValues(new Uint8Array(12)))
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state, clientId }))
  const p = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  })
  location.assign('https://accounts.spotify.com/authorize?' + p.toString())
}

async function tokenRequest(body: Record<string, string>, clientId: string, oldRefresh = ''): Promise<Token> {
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...body, client_id: clientId }),
  })
  if (!r.ok) throw new Error('Spotify-Anmeldung fehlgeschlagen (' + r.status + ')')
  const j = await r.json()
  const t: Token = { access: j.access_token, refresh: j.refresh_token || oldRefresh, exp: Date.now() + (j.expires_in - 60) * 1000, clientId }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(t))
  return t
}

/** Nach der Rückkehr von Spotify: ?code=… gegen ein Token tauschen. Liefert true, wenn eine Anmeldung verarbeitet wurde. */
export async function finishLogin(): Promise<'ok' | 'error' | null> {
  const q = new URLSearchParams(location.search)
  if (!q.has('code') && !q.has('error')) return null
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null')
  sessionStorage.removeItem(PKCE_KEY)
  history.replaceState(null, '', location.pathname)
  if (!saved || q.get('state') !== saved.state || !q.get('code')) return 'error'
  try {
    await tokenRequest({ grant_type: 'authorization_code', code: q.get('code')!, redirect_uri: redirectUri(), code_verifier: saved.verifier }, saved.clientId)
    return 'ok'
  } catch { return 'error' }
}

export async function accessToken(): Promise<string> {
  let t = readToken()
  if (!t) throw new Error('Nicht mit Spotify verbunden')
  if (Date.now() > t.exp) {
    try { t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }, t.clientId, t.refresh) }
    catch (e) { disconnect(); throw e }
  }
  return t.access
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch('https://api.spotify.com/v1' + path, { ...init, headers: { Authorization: 'Bearer ' + (await accessToken()), 'Content-Type': 'application/json', ...(init.headers || {}) } })
  if (r.status === 401) { disconnect(); throw new Error('Spotify-Anmeldung abgelaufen – bitte neu verbinden') }
  if (r.status === 204 || r.status === 202) return null
  const text = await r.text()
  let j: any = null
  try { j = text ? JSON.parse(text) : null } catch { /* manche Antworten sind kein JSON */ }
  if (!r.ok) {
    const err = new Error(j?.error?.message || 'Spotify-Fehler ' + r.status) as Error & { status: number; reason?: string }
    err.status = r.status; err.reason = j?.error?.reason
    throw err
  }
  return j
}

const toTrack = (t: any): SpTrack => ({
  id: t.id, uri: t.uri, name: t.name, artists: (t.artists || []).map((a: any) => a.name).join(', '),
  album: t.album?.name || '', cover: t.album?.images?.[0]?.url || '', coverSmall: t.album?.images?.slice(-1)[0]?.url || '', durationMs: t.duration_ms,
})

export async function searchTracks(q: string): Promise<SpTrack[]> {
  const j = await api('/search?' + new URLSearchParams({ q, type: 'track', limit: '10' }))
  return (j?.tracks?.items || []).filter((t: any) => t?.id).map(toTrack)
}

/** Erkennt einen Playlist-Link (open.spotify.com/playlist/… oder spotify:playlist:…) */
export const playlistId = (q: string) => q.match(/playlist[/:]([A-Za-z0-9]{10,})/)?.[1] ?? null

export async function playlistTracks(id: string): Promise<{ name: string; tracks: SpTrack[] }> {
  let name = 'Playlist'
  try { name = (await api('/playlists/' + id + '?fields=name'))?.name || name } catch { /* Name ist nur Zierde */ }
  const tracks: SpTrack[] = []
  for (let offset = 0; offset < 300; offset += 50) {
    const j = await api('/playlists/' + id + '/items?' + new URLSearchParams({ limit: '50', offset: String(offset) }))
    const items: any[] = j?.items || []
    for (const it of items) {
      const t = it?.item ?? it?.track
      if (t?.id && (t.type ?? 'track') === 'track') tracks.push(toTrack(t))
    }
    if (!j?.next || items.length === 0) break
  }
  return { name, tracks }
}

export const playOn = (uri: string, deviceId?: string) =>
  api('/me/player/play' + (deviceId ? '?device_id=' + deviceId : ''), { method: 'PUT', body: JSON.stringify({ uris: [uri], position_ms: 0 }) })
export const remotePause = () => api('/me/player/pause', { method: 'PUT' })
export const remoteResume = () => api('/me/player/play', { method: 'PUT' })
export const remoteSeek = (ms: number) => api('/me/player/seek?position_ms=' + Math.round(ms), { method: 'PUT' })
export const remoteState = () => api('/me/player')

const lnorm = (x: string) => x.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')

/**
 * Wählt unter mehreren Textfassungen die verlässlichste: In der Datenbank liegen oft etliche Einsendungen
 * zum selben Titel, deren Zeiten um Sekunden voneinander abweichen. Genommen wird die Fassung, deren
 * Zeilenzeiten von den meisten anderen bestätigt werden (Abweichung im Mittel ≤ 0,4 s).
 */
export function consensus(cands: { lines: LyricLine[]; exact?: boolean }[]): { lines: LyricLine[]; support: number } | null {
  if (!cands.length) return null
  const sig = cands.map((c) => { const m = new Map<string, number>(); for (const l of c.lines) { const k = lnorm(l.text).slice(0, 14); if (k.length >= 6 && !m.has(k)) m.set(k, l.t) } return m })
  // agree[i][j]: Fassung j bestätigt Fassung i (Zeilenzeiten im Mittel ≤ 0,4 s auseinander)
  const agree = cands.map((_, i) => cands.map((__, j) => {
    if (i === j) return false
    const d: number[] = []
    for (const [k, t] of sig[i]) { const o = sig[j].get(k); if (o !== undefined) d.push(Math.abs(t - o)) }
    if (d.length < 4) return false
    d.sort((x, y) => x - y)
    return d[d.length >> 1] <= 0.4
  }))
  const support = agree.map((row) => row.filter(Boolean).length)
  // Normalfall: Mehrheit. Wird aber die Fassung, die exakt zu Album und Länge des Spotify-Titels gehört,
  // von mindestens einer weiteren bestätigt, gilt ihre Gruppe – verschiedene Pressungen beginnen unterschiedlich.
  const ex = cands.findIndex((c) => c.exact)
  let pool = cands.map((_, i) => i)
  if (ex >= 0 && support[ex] >= 1) pool = pool.filter((i) => i === ex || agree[ex][i])
  let best = pool[0]
  for (const i of pool) if (support[i] > support[best]) best = i
  // Zeiten glätten: je Zeile der Median aller Fassungen derselben Gruppe mit gleichem Zeilenaufbau
  const base = cands[best].lines
  const mates = cands.filter((c, j) => (j === best || agree[best][j]) && c.lines.length === base.length && c.lines.every((l, k) => lnorm(l.text).slice(0, 8) === lnorm(base[k].text).slice(0, 8)))
  const lines = base.map((l, k) => {
    const ts = mates.map((m) => m.lines[k].t).sort((x, y) => x - y)
    return { ...l, t: ts.length >= 3 ? ts[ts.length >> 1] : l.t }
  })
  return { lines, support: support[best] }
}

/** Synchronen Liedtext aus LRCLIB holen; unter den Fassungen passender Länge entscheidet die Mehrheit. */
export async function lyricsFor(t: SpTrack): Promise<{ lines: LyricLine[]; plain: string; diff: number }> {
  const key = 'encore-lyr5-' + t.id
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c } catch { /* neu laden */ }
  const artist = t.artists.split(',')[0]
  const title = t.name.replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '').replace(/\s*\((feat|with|remaster)[^)]*\)/gi, '')
  const dur = t.durationMs / 1000
  const get = async (path: string) => { try { const r = await fetch('https://lrclib.net/api/' + path); return r.ok ? await r.json() : null } catch { return null } }
  const [exact, s1, s2] = await Promise.all([
    get('get?' + new URLSearchParams({ track_name: t.name, artist_name: artist, album_name: t.album, duration: String(Math.round(dur)) })),
    get('search?' + new URLSearchParams({ track_name: title, artist_name: artist })),
    get('search?' + new URLSearchParams({ q: title + ' ' + artist })),
  ])
  const seen = new Set<number>()
  const hits: any[] = []
  for (const h of [exact, ...(Array.isArray(s1) ? s1 : []), ...(Array.isArray(s2) ? s2 : [])]) {
    if (h?.id && !seen.has(h.id)) { seen.add(h.id); hits.push(h) }
  }
  const synced = hits.filter((h) => h.syncedLyrics)
  let pool = synced.filter((h) => Math.abs((h.duration || 0) - dur) <= 2)
  if (!pool.length) pool = synced.filter((h) => Math.abs((h.duration || 0) - dur) <= 4)
  const pickd = consensus(pool.map((h) => ({ lines: parseLrc(h.syncedLyrics).filter((l) => l.text), exact: h.id === exact?.id })))
  const diff = pool.length ? Math.min(...pool.map((h) => Math.abs((h.duration || 0) - dur))) : 99
  const out = { lines: pickd?.lines ?? [], plain: (hits.find((h) => h.plainLyrics)?.plainLyrics as string) || '', diff: Math.round(diff * 10) / 10 }
  if (hits.length) { try { localStorage.setItem(key, JSON.stringify(out)) } catch { /* Speicher voll – egal */ } }
  return out
}

// ---------- Wiedergabe ----------

export interface Transport {
  kind: 'browser' | 'remote'
  deviceName: string
  /** Position in Sekunden, zwischen den Statusmeldungen hochgerechnet */
  time(): number
  duration(): number
  paused(): boolean
  toggle(): Promise<void>
  seek(sec: number): Promise<void>
  setVolume(v: number): void
  destroy(): void
}

function loadSdk(): Promise<any> {
  const w = window as any
  if (w.Spotify?.Player) return Promise.resolve(w.Spotify)
  return new Promise((resolve, reject) => {
    w.onSpotifyWebPlaybackSDKReady = () => resolve(w.Spotify)
    const s = document.createElement('script')
    s.src = 'https://sdk.scdn.co/spotify-player.js'
    s.onerror = () => reject(new Error('Spotify-Player konnte nicht geladen werden'))
    document.head.appendChild(s)
    setTimeout(() => reject(new Error('Spotify-Player antwortet nicht')), 12000)
  })
}

// Ein einziger Spotify-Player je App-Sitzung. Früher wurde für jeden Song ein neuer angemeldet und danach wieder
// abgemeldet – Spotify kennt ein frisch angemeldetes Gerät aber oft erst nach Sekunden („Device not found"),
// und schnelles An-/Abmelden führt zu sporadischen Fehlern. Jetzt bleibt das Gerät angemeldet.
interface Shared { player: any; deviceId: string; online: boolean; onState: ((s: any) => void) | null; waiters: (() => void)[] }
let shared: Promise<Shared> | null = null
let livePlayer: any = null

function ensurePlayer(volume: number): Promise<Shared> {
  if (shared) return shared
  const p = (async () => {
    const Spotify = await loadSdk()
    const player = new Spotify.Player({ name: 'Encore Karaoke', volume, getOAuthToken: (cb: (t: string) => void) => { accessToken().then(cb).catch(() => cb('')) } })
    const sh: Shared = { player, deviceId: '', online: false, onState: null, waiters: [] }
    player.addListener('player_state_changed', (st: any) => sh.onState?.(st))
    player.addListener('not_ready', () => { sh.online = false })
    await new Promise<void>((resolve, reject) => {
      // „ready" kommt auch nach einer Verbindungsunterbrechung erneut – dann ggf. mit neuer Geräte-ID
      player.addListener('ready', (e: any) => { sh.deviceId = e.device_id; sh.online = true; resolve(); sh.waiters.splice(0).forEach((w) => w()) })
      for (const ev of ['initialization_error', 'authentication_error', 'account_error']) player.addListener(ev, (e: any) => reject(new Error(e.message)))
      player.connect().then((ok: boolean) => { if (!ok) reject(new Error('Verbindung zu Spotify fehlgeschlagen')) })
      setTimeout(() => reject(new Error('Spotify-Player wurde nicht bereit')), 12000)
    })
    livePlayer = player
    return sh
  })()
  shared = p
  p.catch(() => { if (shared === p) shared = null })
  return p
}

function dropPlayer() {
  try { livePlayer?.disconnect() } catch { /* schon getrennt */ }
  livePlayer = null; shared = null
}

// War die Seite länger im Hintergrund (Handy gesperrt, andere App offen), hat der Browser die Verbindung zu Spotify
// meist still gekappt – der Player sieht dann noch „angemeldet" aus, reagiert aber nicht mehr. Deshalb beim
// Zurückkommen frisch anmelden, statt beim nächsten Song lange auf ein totes Gerät zu warten.
let hiddenAt = 0
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return }
    if (hiddenAt && Date.now() - hiddenAt > 20000 && shared && !busyPlaying) { dropPlayer(); warmUpSpotify() }
    hiddenAt = 0
  })
}
/** true, solange ein Song über den Browser-Player läuft – dann wird er nicht neu angemeldet */
let busyPlaying = false

/** Player schon beim Öffnen der Spotify-Suche anmelden – beim ersten Song ist das Gerät dann längst bekannt. */
export function warmUpSpotify(volume = 0.9) { if (isConnected()) void ensurePlayer(volume).catch(() => {}) }
/** Direkt im Klick aufrufen: erlaubt dem Browser (v. a. am Handy und Fernseher), Ton ohne weiteren Tipp zu starten. */
export function activateSpotify() { try { void livePlayer?.activateElement?.() } catch { /* nicht nötig */ } }

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wiedergabe direkt in diesem Browser (Web Playback SDK, nur Premium). */
export async function browserTransport(track: SpTrack, volume: number, onTry?: (n: number) => void): Promise<Transport> {
  const t0 = performance.now()
  const LIMIT = 22000 // länger soll niemand auf den Start warten – dann lieber eine klare Meldung
  let sh = await ensurePlayer(volume)
  let pos = 0, at = performance.now(), paused = true, dur = track.durationMs
  const started = performance.now()
  let seen = false
  const take = (st: any, lag = 0) => {
    if (!st) return
    // Meldungen des vorherigen Songs ignorieren, bis der neue wirklich läuft (spätestens nach 4 s alles annehmen)
    const cur = st.track_window?.current_track
    const mine = !cur || cur.id === track.id || cur?.linked_from?.id === track.id || cur?.uri === track.uri
    if (!mine && !seen && performance.now() - started < 4000) return
    seen = true
    pos = st.position + lag; at = performance.now(); paused = st.paused
    if (st.duration) dur = st.duration
  }
  const attach = () => { sh.onState = (st) => take(st); void sh.player.setVolume(volume).catch(() => {}) }
  attach()
  try { await sh.player.activateElement?.() } catch { /* nur auf Mobilgeräten nötig */ }

  let lastErr: unknown
  for (let i = 0; i < 10; i++) {
    if (performance.now() - t0 > LIMIT) { lastErr = lastErr ?? new Error('Spotify hat nicht rechtzeitig geantwortet'); break }
    onTry?.(i + 1)
    try {
      if (!sh.online) {
        // Gerät kurzzeitig abgemeldet: kurz auf die Wiederanmeldung warten, sonst neu verbinden
        await Promise.race([new Promise<void>((r) => sh.waiters.push(r)), wait(2500)])
        if (!sh.online) await sh.player.connect().catch(() => {})
      }
      await playOn(track.uri, sh.deviceId)
      lastErr = undefined
      break
    } catch (e) {
      lastErr = e
      const status = (e as { status?: number }).status
      if (status === 401 || status === 403) break // Anmeldung/Premium – Wiederholen hilft nicht
      await wait(400 + i * 200)
      // erst das Gerät aktiv bei Spotify anmelden; hilft das nicht, den Player komplett neu aufbauen (frische Geräte-ID)
      if (i === 0 || i === 4) await api('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [sh.deviceId], play: false }) }).catch(() => {})
      if (i === 2 || i === 6) { dropPlayer(); sh = await ensurePlayer(volume); attach(); try { await sh.player.activateElement?.() } catch { /* nur mobil */ } }
    }
  }
  if (lastErr) { sh.onState = null; throw lastErr }
  busyPlaying = true

  // Statusmeldungen kommen nur bei Änderungen. Damit Puffern/Nachladen den Text nicht verschiebt,
  // wird die echte Position zusätzlich zweimal pro Sekunde abgefragt.
  const sync = setInterval(() => {
    const t0 = performance.now()
    sh.player.getCurrentState().then((st: any) => take(st, (performance.now() - t0) / 2)).catch(() => {})
  }, 500)
  return {
    kind: 'browser', deviceName: 'dieses Gerät',
    time: () => Math.min(dur, paused ? pos : pos + (performance.now() - at)) / 1000,
    duration: () => dur / 1000,
    paused: () => paused,
    toggle: () => sh.player.togglePlay(),
    seek: async (sec) => { pos = sec * 1000; at = performance.now(); await sh.player.seek(sec * 1000) },
    setVolume: (v) => void sh.player.setVolume(v),
    // Player bleibt angemeldet – nur anhalten
    destroy: () => { busyPlaying = false; clearInterval(sync); if (sh.onState) sh.onState = null; try { void sh.player.pause() } catch { /* egal */ } },
  }
}

/** Wiedergabe auf einem anderen Spotify-Gerät (Fernseher, Handy, Box) über Spotify Connect; Position per Abfrage. */
export async function remoteTransport(track: SpTrack): Promise<Transport> {
  try { await playOn(track.uri) }
  catch (e) {
    const err = e as Error & { status?: number; reason?: string }
    if (err.status === 404 || err.reason === 'NO_ACTIVE_DEVICE') throw new Error('Kein aktives Spotify-Gerät gefunden. Öffne Spotify auf dem Fernseher oder Handy, starte kurz einen beliebigen Song und versuche es erneut.')
    throw e
  }
  let pos = 0, at = performance.now(), paused = false, dur = track.durationMs, name = 'Spotify-Gerät', stopped = false
  const poll = async () => {
    const t0 = performance.now()
    try {
      const s = await remoteState()
      if (s && s.item?.id === track.id) {
        const lag = (performance.now() - t0) / 2
        pos = (s.progress_ms || 0) + lag; at = performance.now(); paused = !s.is_playing
        dur = s.item.duration_ms || dur; name = s.device?.name || name
      }
    } catch { /* nächster Versuch */ }
  }
  await new Promise((r) => setTimeout(r, 600))
  await poll()
  const id = setInterval(() => { if (!stopped) void poll() }, 1500)
  return {
    kind: 'remote', get deviceName() { return name },
    time: () => Math.min(dur, paused ? pos : pos + (performance.now() - at)) / 1000,
    duration: () => dur / 1000,
    paused: () => paused,
    toggle: async () => { if (paused) { await remoteResume(); paused = false; at = performance.now() } else { pos = pos + (performance.now() - at); paused = true; await remotePause() } },
    seek: async (s) => { pos = s * 1000; at = performance.now(); await remoteSeek(s * 1000) },
    setVolume: () => {},
    destroy: () => { stopped = true; clearInterval(id); void remotePause().catch(() => {}) },
  } as Transport
}
