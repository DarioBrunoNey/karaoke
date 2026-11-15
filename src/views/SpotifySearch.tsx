import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon, fmtTime } from '../ui'
import { disconnect, isConnected, playlistId, playlistTracks, searchTracks, startLogin } from '../spotify/api'
import type { SpTrack } from '../lib/types'

export default function SpotifySearch() {
  const { settings, go, playSpotify, enqueue } = useStore()
  const [connected, setConnected] = useState(isConnected())
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SpTrack[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [listName, setListName] = useState('')

  useEffect(() => {
    if (!connected || q.trim().length < 2) { setHits(null); return }
    let stale = false
    const id = setTimeout(async () => {
      setBusy(true); setErr('')
      try {
        const pl = playlistId(q)
        if (pl) { const r = await playlistTracks(pl); if (!stale) { setHits(r.tracks); setListName(r.name) } }
        else { const r = await searchTracks(q.trim()); if (!stale) { setHits(r); setListName('') } }
      }
      catch (e) { if (!stale) { setErr((e as Error).message); setConnected(isConnected()) } }
      if (!stale) setBusy(false)
    }, 350)
    return () => { stale = true; clearTimeout(id) }
  }, [q, connected])

  if (!settings.spotifyClientId) return (
    <Box title="Spotify einmalig einrichten" text="Für den Mitsing-Modus braucht die App eine eigene, kostenlose Spotify-Entwickler-Kennung (Client-ID). Das dauert etwa fünf Minuten – die Schritte stehen unter „Hilfe & Musikquellen“.">
      <button className="btn-primary" onClick={() => go({ name: 'info' })}>Zur Einrichtung</button>
    </Box>
  )
  if (!connected) return (
    <Box title="Mit Spotify verbinden" text="Du wirst zu Spotify weitergeleitet und bestätigst dort den Zugriff. Benötigt Spotify Premium. Die App steuert nur die Wiedergabe und liest keine privaten Daten aus.">
      <button className="btn-primary" onClick={() => void startLogin(settings.spotifyClientId)}>Mit Spotify verbinden</button>
    </Box>
  )
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-xl">
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input autoFocus className="field rounded-full pl-12" placeholder="Bei Spotify suchen – oder Playlist-Link einfügen" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button className="chip" onClick={() => { disconnect(); setConnected(false) }}>Spotify trennen</button>
      </div>
      <p className="mt-3 text-sm text-white/50">Spotify spielt die Originalaufnahme, die App zeigt den Text und bewertet deine Stimme (Tonsicherheit und Timing). Für „zu hoch / zu tief“ je Ton im Player eine Melodie-Datei laden. Am genauesten mit Kopfhörern.</p>
      {err && <p className="mt-4 rounded-2xl bg-red-500/15 p-3 text-red-200">{err}</p>}
      {busy && !hits && <p className="mt-6 text-white/50">Suche …</p>}
      {listName && hits && hits.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-black tracking-tight">{listName} <span className="text-base font-semibold text-white/50">· {hits.length} Titel</span></h2>
          <button className="btn ml-auto" onClick={() => hits.forEach((t) => enqueue('', undefined, t))}><Icon name="queue" size={20} />Alle in die Warteschlange</button>
        </div>
      )}
      {hits && hits.length === 0 && <p className="mt-6 text-white/50">Nichts gefunden.</p>}
      <ul className="mt-4 space-y-2">
        {hits?.map((t) => (
          <li key={t.id} className="glass flex items-center gap-4 rounded-2xl p-2.5">
            <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-4 text-left" onClick={() => playSpotify(t)} aria-label={`${t.name} mitsingen`}>
              <img src={t.coverSmall || t.cover} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
              <span className="min-w-0 flex-1"><span className="block truncate text-lg font-bold">{t.name}</span><span className="block truncate text-sm text-white/55">{t.artists} · {fmtTime(t.durationMs / 1000)}</span></span>
              <span className="grad flex h-11 w-11 shrink-0 items-center justify-center rounded-full"><Icon name="play" /></span>
            </button>
            <button className="btn-icon h-11 w-11 shrink-0 bg-transparent" aria-label="Zur Warteschlange" title="Zur Warteschlange" onClick={() => enqueue('', undefined, t)}><Icon name="queue" size={20} /></button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Box({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="glass mx-auto mt-8 max-w-2xl p-8 text-center">
      <h2 className="text-3xl font-black tracking-tight">{title}</h2>
      <p className="mx-auto mt-3 max-w-xl text-white/65">{text}</p>
      <div className="mt-6">{children}</div>
    </div>
  )
}
