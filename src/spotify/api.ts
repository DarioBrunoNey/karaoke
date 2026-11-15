// Spotify-Anbindung für den Mitsing-Modus – ausschließlich offizielle Wege:
// Anmeldung per OAuth (PKCE, ohne Geheimnis), Wiedergabe über das Web Playback SDK bzw. Spotify Connect.
// Die App steuert nur die Wiedergabe; auf das Audiosignal gibt es keinen Zugriff (und es wird keiner versucht).
import type { LyricLine, SpTrack } from '../lib/types'
import { parseLrc } from '../lib/lrc'

const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state'
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

export const playOn = (uri: string, deviceId?: string) =>
  api('/me/player/play' + (deviceId ? '?device_id=' + deviceId : ''), { method: 'PUT', body: JSON.stringify({ uris: [uri], position_ms: 0 }) })
export const remotePause = () => api('/me/player/pause', { method: 'PUT' })
export const remoteResume = () => api('/me/player/play', { method: 'PUT' })
export const remoteSeek = (ms: number) => api('/me/player/seek?position_ms=' + Math.round(ms), { method: 'PUT' })
export const remoteState = () => api('/me/player')

/** Synchronen Liedtext aus LRCLIB holen (Treffer mit passender Länge bevorzugt); Ergebnis wird je Titel gemerkt. */
export async function lyricsFor(t: SpTrack): Promise<{ lines: LyricLine[]; plain: string }> {
  const key = 'encore-lyr-' + t.id
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c) return c } catch { /* neu laden */ }
  const artist = t.artists.split(',')[0]
  const title = t.name.replace(/\s+-\s+.*(remaster|version|edit|mix|live).*$/i, '').replace(/\s*\((feat|with|remaster)[^)]*\)/gi, '')
  const dur = t.durationMs / 1000
  let hits: any[] = []
  try {
    const r = await fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: title, artist_name: artist }))
    if (r.ok) hits = await r.json()
  } catch { /* offline oder Dienst nicht erreichbar */ }
  const score = (h: any) => (h.syncedLyrics ? 0 : 1000) + Math.abs((h.duration || 0) - dur)
  hits.sort((a, b) => score(a) - score(b))
  const best = hits[0]
  const out = {
    lines: best?.syncedLyrics && Math.abs(best.duration - dur) < 8 ? parseLrc(best.syncedLyrics).filter((l) => l.text) : [],
    plain: (best?.plainLyrics as string) || '',
  }
  if (best) { try { localStorage.setItem(key, JSON.stringify(out)) } catch { /* Speicher voll – egal */ } }
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

/** Wiedergabe direkt in diesem Browser (Web Playback SDK, nur Premium). */
export async function browserTransport(track: SpTrack, volume: number): Promise<Transport> {
  const Spotify = await loadSdk()
  const player = new Spotify.Player({ name: 'Encore Karaoke', volume, getOAuthToken: (cb: (t: string) => void) => { accessToken().then(cb).catch(() => cb('')) } })
  let pos = 0, at = performance.now(), paused = true, dur = track.durationMs
  player.addListener('player_state_changed', (s: any) => {
    if (!s) return
    pos = s.position; at = performance.now(); paused = s.paused
    if (s.duration) dur = s.duration
  })
  const deviceId = await new Promise<string>((resolve, reject) => {
    player.addListener('ready', (e: any) => resolve(e.device_id))
    for (const ev of ['initialization_error', 'authentication_error', 'account_error']) player.addListener(ev, (e: any) => reject(new Error(e.message)))
    player.connect().then((ok: boolean) => { if (!ok) reject(new Error('Verbindung zu Spotify fehlgeschlagen')) })
    setTimeout(() => reject(new Error('Spotify-Player wurde nicht bereit')), 15000)
  })
  try { await player.activateElement?.() } catch { /* nur auf Mobilgeräten nötig */ }
  // Das neue Gerät ist bei Spotify manchmal erst nach einem Moment bekannt
  for (let i = 0; ; i++) {
    try { await playOn(track.uri, deviceId); break }
    catch (e) { if (i >= 3) { player.disconnect(); throw e } await new Promise((r) => setTimeout(r, 700)) }
  }
  return {
    kind: 'browser', deviceName: 'dieses Gerät',
    time: () => Math.min(dur, paused ? pos : pos + (performance.now() - at)) / 1000,
    duration: () => dur / 1000,
    paused: () => paused,
    toggle: () => player.togglePlay(),
    seek: async (s) => { pos = s * 1000; at = performance.now(); await player.seek(s * 1000) },
    setVolume: (v) => void player.setVolume(v),
    destroy: () => { try { player.pause(); player.disconnect() } catch { /* schon getrennt */ } },
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
