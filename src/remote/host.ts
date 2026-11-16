// Verwaltet die verbundenen Handy-Mikrofone auf der Seite der Karaoke-App.
import type { MicSample } from '../audio/mic'
import { openHost, type HostLink } from './link'
import { BleedGate } from '../lib/bleed'

export interface Phone { cid: string; name: string; pid: string }
interface Live { midi: number; level: number; rms: number; at: number; used: number }
// je Handy: wie laut kommt die Musik aus dem Fernseher dort an? Etwas strenger als beim eingebauten Mikrofon,
// weil der Fernseher-Ton den ganzen Raum füllt.
const gates = new Map<string, BleedGate>()

const live = new Map<string, Live>() // je Sänger-Profil der zuletzt gemeldete Ton
const byCid = new Map<string, Phone>()
let link: HostLink | null = null

export interface HostCallbacks {
  /** ordnet einen Namen einem Sängerprofil zu (legt es bei Bedarf an) und liefert dessen ID */
  profileFor(name: string): Promise<{ id: string; color: string }>
  onChange(phones: Phone[]): void
}

export async function startPhoneHost(cb: HostCallbacks): Promise<string> {
  if (link) return link.code
  link = await openHost({
    onOpen: async (cid, hello) => {
      const name = hello.name.trim().slice(0, 24) || 'Gast'
      const pr = await cb.profileFor(name)
      const pid = pr.id
      link?.send(cid, { k: 'w', color: pr.color })
      link?.send(cid, { k: 't', you: now.pids.includes(pid), song: now.song })
      // gleiches Profil von einem neuen Handy: altes ersetzen
      for (const [k, v] of byCid) if (v.pid === pid) byCid.delete(k)
      byCid.set(cid, { cid, name, pid })
      cb.onChange([...byCid.values()])
    },
    onData: (cid, m) => {
      const ph = byCid.get(cid)
      if (ph) live.set(ph.pid, { midi: m.m, level: m.l, rms: m.r ?? m.l / 6, at: performance.now(), used: 0 })
    },
    onClose: (cid) => { const ph = byCid.get(cid); if (ph) { byCid.delete(cid); live.delete(ph.pid); cb.onChange([...byCid.values()]) } },
  })
  return link.code
}

let now: { pids: string[]; song: string } = { pids: [], song: '' }
/** Sagt allen Handys, welcher Song läuft und ob ihr Besitzer gerade singt */
export function announceTurn(pids: string[], song: string) {
  now = { pids, song }
  for (const ph of byCid.values()) link?.send(ph.cid, { k: 't', you: pids.includes(ph.pid), song })
}

export const hasPhone = (pid: string) => [...byCid.values()].some((p) => p.pid === pid)

/**
 * Aktueller Ton vom Handy dieses Sängers; null, wenn er kein Handy-Mikrofon hat.
 * @param quiet true, wenn laut Song gerade niemand singen soll – dann wird gemessen, wie laut die Musik am Handy ankommt
 */
export function phoneSample(pid: string, quiet = false): MicSample | null {
  if (!hasPhone(pid)) return null
  const l = live.get(pid)
  if (!l || performance.now() - l.at > 300) return { midi: 0, level: 0, voiced: false }
  let g = gates.get(pid)
  if (!g) { g = new BleedGate(2.3); gates.set(pid, g) }
  if (l.used !== l.at) { l.used = l.at; g.feed(l.rms, quiet) } // jeden Messwert nur einmal zählen
  const voiced = l.midi > 0 && g.passes(l.rms)
  return { midi: voiced ? l.midi : 0, level: l.level, voiced }
}
/** Pegel der mitgehörten Musik am Handy dieses Sängers */
export const phoneBleed = (pid: string) => gates.get(pid)?.level ?? 0
/** neuer Song: Messung neu beginnen (andere Lautstärke, andere Abmischung) */
export const resetPhoneGates = () => gates.clear()

export const phoneUrl = (code: string) => `${location.origin}${location.pathname}?mic=${code}${new URLSearchParams(location.search).has('bc') ? '&bc' : ''}`
