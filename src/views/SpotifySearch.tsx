import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { Icon, fmtTime } from '../ui'
import { disconnect, isConnected, playlistId, playlistTracks, searchTracks, startLogin, warmUpSpotify } from '../spotify/api'
import { tracksWithNotes } from '../spotify/melodyDb'
import type { SpTrack } from '../lib/types'

interface SavedList { id: string; name: string }
const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(localStorage.getItem(key) || '') as T } catch { return fallback } }

export default function SpotifySearch() {
  const { settings, go, playSpotify, enqueue } = useStore()
  const [connected, setConnected] = useState(isConnected())
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SpTrack[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [listName, setListName] = useState('')
  const [lists, setLists] = useState<SavedList[]>(() => read('encore-sp-lists', []))
  const [notes, setNotes] = useState<Set<string>>(new Set())
  const recent = useMemo(() => read<SpTrack[]>('encore-sp-recent', []), [])

  useEffect(() => {
    if (!connected || q.trim().length < 2) { setHits(null); setListName(''); return }
    let stale = false
    const id = setTimeout(async () => {
      setBusy(true); setErr('')
      try {
        const pl = playlistId(q)
        if (pl) {
          const r = await playlistTracks(pl)
          if (stale) return
          setHits(r.tracks); setListName(r.name)
          // Playlist merken – beim nächsten Mal genügt ein Klick
          setLists((old) => { const next = [{ id: pl, name: r.name }, ...old.filter((x) => x.id !== pl)].slice(0, 8); localStorage.setItem('encore-sp-lists', JSON.stringify(next)); return next })
        } else { const r = await searchTracks(q.trim()); if (!stale) { setHits(r); setListName('') } }
      }
      catch (e) { if (!stale) { setErr((e as Error).message); setConnected(isConnected()) } }
      if (!stale) setBusy(false)
    }, 350)
    return () => { stale = true; clearTimeout(id) }
  }, [q, connected])

  useEffect(() => { if (connected) warmUpSpotify(settings.volume) }, [connected, settings.volume])

  const shown = hits ?? recent
  // Welche Titel haben Notendaten (volle Anzeige mit Röhren)?
  useEffect(() => {
    let stale = false
    if (shown.length) void tracksWithNotes(shown).then((s) => { if (!stale) setNotes(s) }).catch(() => {})
    return () => { stale = true }
  }, [shown])

  if (!settings.spotifyClientId) return (
    <Box title="Spotify einmalig einrichten" text="Für Songs aus Spotify braucht die App eine eigene, kostenlose Spotify-Entwickler-Kennung (Client-ID). Das dauert etwa fünf Minuten – die Schritte stehen unter „Hilfe & Musikquellen“.">
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
      <div className="relative">
        <Icon name="search" size={26} className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-white/40" />
        <input autoFocus className="w-full rounded-full border border-white/10 bg-white/[.07] py-5 pl-16 pr-14 text-xl font-semibold text-white placeholder-white/35 outline-none backdrop-blur transition focus:border-white/40 focus:bg-white/10 sm:text-2xl"
          style={{ outline: 'none' }} placeholder="Bei Spotify suchen – oder Playlist-Link einfügen" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <button className="absolute right-4 top-1/2 flex h-10 w-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white/50 hover:bg-white/10 hover:text-white" aria-label="Suche leeren" onClick={() => setQ('')}><Icon name="close" /></button>}
      </div>

      {lists.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold uppercase tracking-widest text-white/40">Playlists</span>
          {lists.map((l) => <button key={l.id} className={`chip ${listName === l.name && hits ? 'chip-on' : ''}`} onClick={() => setQ('spotify:playlist:' + l.id)}>{l.name}</button>)}
        </div>
      )}

      {err && <p className="mt-5 rounded-2xl bg-red-500/15 p-3 text-red-200">{err}</p>}

      <div className="mt-7 flex flex-wrap items-end gap-3">
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
          {hits ? (listName || 'Treffer') : recent.length ? 'Zuletzt gesungen' : 'Los geht\'s'}
          {hits && hits.length > 0 && <span className="ml-3 text-base font-semibold text-white/45">{hits.length} Titel</span>}
        </h2>
        {busy && <span className="pb-1 text-white/50">Suche …</span>}
        {listName && hits && hits.length > 0 && <button className="btn ml-auto" onClick={() => hits.forEach((t) => enqueue('', undefined, t))}><Icon name="queue" size={20} />Alle in die Warteschlange</button>}
      </div>

      {hits && hits.length === 0 && !busy && <p className="mt-4 text-lg text-white/50">Nichts gefunden.</p>}
      {!hits && !recent.length && <p className="mt-3 max-w-2xl text-lg text-white/55">Such einen Song oder füg den Link einer Spotify-Playlist ein. Titel mit dem Zeichen <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-sm font-bold text-emerald-300">♪ Noten</span> haben die volle Anzeige mit Notenröhren und Trefferwertung.</p>}

      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {shown.map((t) => (
          <div key={t.id} className="group rise">
            <div className="relative">
              <button onClick={() => playSpotify(t)} className="block w-full cursor-pointer transition duration-200 group-hover:-translate-y-1" aria-label={`${t.name} mitsingen`}>
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-white/5 shadow-2xl shadow-black/50">
                  {t.cover ? <img src={t.cover} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grad flex h-full w-full items-center justify-center opacity-70"><Icon name="music" size={56} /></div>}
                </div>
                <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-within:opacity-100">
                  <span className="grad flex h-16 w-16 items-center justify-center rounded-full shadow-xl"><Icon name="play" size={30} /></span>
                </span>
              </button>
              {notes.has(t.id) && <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-emerald-400 px-2.5 py-1 text-xs font-black text-black shadow-lg" title="Mit Notenröhren und Trefferwertung">♪ Noten</span>}
            </div>
            <div className="mt-3 flex items-start gap-1">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold">{t.name}</p>
                <p className="truncate text-sm text-white/55">{t.artists} · {fmtTime(t.durationMs / 1000)}</p>
              </div>
              <button className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" aria-label="Zur Warteschlange" title="Zur Warteschlange" onClick={() => enqueue('', undefined, t)}><Icon name="queue" size={20} /></button>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-10 text-sm text-white/35">
        Spotify spielt die Originalaufnahme, die App zeigt Text und Noten und bewertet deine Stimme.
        <button className="ml-3 cursor-pointer underline hover:text-white/70" onClick={() => { disconnect(); setConnected(false) }}>Spotify trennen</button>
      </p>
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
