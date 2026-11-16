// Verbindung Handy ↔ Karaoke-App. Übertragen werden nur Zahlen (erkannte Tonhöhe, Pegel) – kein Ton.
// Standard: WebRTC-Datenkanal über PeerJS (öffentlicher Vermittlungsdienst nur zum Verbindungsaufbau).
// Mit „?bc" in der Adresse: BroadcastChannel – verbindet zwei Tabs desselben Browsers (für Tests).
export interface Hello { name: string }
export interface PitchMsg { k: 'p'; m: number; l: number }
export interface HostHandlers { onOpen(cid: string, hello: Hello): void; onData(cid: string, msg: PitchMsg): void; onClose(cid: string): void }
/** App → Handy: Begrüßung (Farbe des Sängers) und wer gerade singt */
export type HostMsg = { k: 'w'; color: string } | { k: 't'; you: boolean; song: string }
export interface HostLink { code: string; send(cid: string, msg: HostMsg): void; close(): void }
export interface ClientLink { send(msg: PitchMsg): void; close(): void }

const useBc = () => new URLSearchParams(location.search).has('bc')
const PREFIX = 'encore-karaoke-mic-'
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('')

export async function openHost(h: HostHandlers): Promise<HostLink> {
  const code = newCode()
  if (useBc()) {
    const ch = new BroadcastChannel(PREFIX + code)
    ch.onmessage = (e) => {
      const d = e.data
      if (d.to) return // eigene Nachrichten an Handys
      if (d.k === 'hello') h.onOpen(d.from, { name: d.name })
      else if (d.k === 'bye') h.onClose(d.from)
      else if (d.k === 'p') h.onData(d.from, d)
    }
    return { code, send: (cid, msg) => ch.postMessage({ ...msg, to: cid }), close: () => ch.close() }
  }
  const { Peer } = await import('peerjs')
  const peer = new Peer(PREFIX + code)
  const conns = new Map<string, { open: boolean; send(d: unknown): void }>()
  await new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve())
    peer.on('error', (e) => reject(new Error('Vermittlungsdienst nicht erreichbar (' + e.type + ')')))
    setTimeout(() => reject(new Error('Vermittlungsdienst antwortet nicht')), 12000)
  })
  peer.on('connection', (conn) => {
    conn.on('open', () => { conns.set(conn.connectionId, conn); h.onOpen(conn.connectionId, { name: String((conn.metadata as Hello | undefined)?.name ?? 'Gast') }) })
    conn.on('data', (d) => { const m = d as PitchMsg; if (m?.k === 'p') h.onData(conn.connectionId, m) })
    conn.on('close', () => { conns.delete(conn.connectionId); h.onClose(conn.connectionId) })
  })
  peer.on('disconnected', () => { try { peer.reconnect() } catch { /* wird beim nächsten Start neu aufgebaut */ } })
  return { code, send: (cid, msg) => { const c = conns.get(cid); if (c?.open) c.send(msg) }, close: () => peer.destroy() }
}

export async function joinHost(code: string, hello: Hello, onState: (s: 'open' | 'closed') => void, onMsg: (m: HostMsg) => void = () => {}): Promise<ClientLink> {
  if (useBc()) {
    const ch = new BroadcastChannel(PREFIX + code)
    const from = newCode()
    ch.onmessage = (e) => { if (e.data?.to === from) onMsg(e.data) }
    ch.postMessage({ k: 'hello', from, name: hello.name })
    onState('open')
    return { send: (m) => ch.postMessage({ ...m, from }), close: () => { ch.postMessage({ k: 'bye', from }); ch.close() } }
  }
  const { Peer } = await import('peerjs')
  const peer = new Peer()
  await new Promise<void>((resolve, reject) => {
    peer.on('open', () => resolve())
    peer.on('error', (e) => reject(new Error('Keine Verbindung (' + e.type + ')')))
    setTimeout(() => reject(new Error('Vermittlungsdienst antwortet nicht')), 12000)
  })
  const conn = peer.connect(PREFIX + code, { metadata: hello, reliable: false })
  await new Promise<void>((resolve, reject) => {
    conn.on('open', () => resolve())
    peer.on('error', (e) => reject(new Error(e.type === 'peer-unavailable' ? 'Die Karaoke-App wurde nicht gefunden. Läuft sie noch, und ist der QR-Code aktuell?' : 'Keine Verbindung (' + e.type + ')')))
    setTimeout(() => reject(new Error('Verbindung zur Karaoke-App kam nicht zustande')), 15000)
  })
  onState('open')
  conn.on('data', (d) => onMsg(d as HostMsg))
  conn.on('close', () => onState('closed'))
  peer.on('disconnected', () => onState('closed'))
  return { send: (m) => { if (conn.open) conn.send(m) }, close: () => peer.destroy() }
}
