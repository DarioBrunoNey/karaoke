import { useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Cover, Icon, fmtTime } from '../ui'
import type { Song } from '../lib/types'
import SpotifySearch from './SpotifySearch'

type Tab = 'all' | 'fav' | 'recent' | 'spotify'

export default function Library() {
  const { songs, importFiles, play, enqueue, updateSong, setEdit, scores, queue, playNext, libraryTab: tab, setLibraryTab: setTab } = useStore()
  const [q, setQ] = useState('')
  const file = useRef<HTMLInputElement>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    let l = songs.filter((s) => !needle || (s.title + ' ' + s.artist).toLowerCase().includes(needle))
    if (tab === 'fav') l = l.filter((s) => s.favorite)
    if (tab === 'recent') l = l.filter((s) => s.lastPlayed).sort((a, b) => b.lastPlayed! - a.lastPlayed!)
    else l = [...l].sort((a, b) => a.title.localeCompare(b.title, 'de'))
    return l
  }, [songs, q, tab])
  const best = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of scores) m.set(s.songId, Math.max(m.get(s.songId) ?? 0, s.total))
    return m
  }, [scores])

  return (
    <div className="pb-10">
      <section className="glass relative mt-2 overflow-hidden p-7 sm:p-10">
        <div className="grad absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-40 blur-3xl" />
        <p className="text-sm font-semibold uppercase tracking-[.25em] text-white/50">Deine Bühne</p>
        <h1 className="mt-2 max-w-3xl text-4xl font-black leading-tight tracking-tight sm:text-6xl">Sing los. <span className="grad-text">Ohne Extra-Mikrofon.</span></h1>
        <p className="mt-3 max-w-2xl text-lg text-white/60">Eigene Songs hinzufügen, Gesang herausrechnen, Text mitlesen – das eingebaute Mikrofon bewertet deine Tonhöhe live.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <button className="btn-primary px-7 py-4 text-lg" onClick={() => file.current?.click()}><Icon name="plus" />Songs hinzufügen</button>
          {queue.length > 0 && <button className="btn px-7 py-4 text-lg" onClick={() => playNext()}><Icon name="play" />Warteschlange starten ({queue.length})</button>}
        </div>
        <input ref={file} type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.opus,.aac" multiple hidden
          onChange={(e) => { void importFiles([...(e.target.files ?? [])]); e.target.value = '' }} />
      </section>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <div className={`relative min-w-60 flex-1 sm:max-w-md ${tab === 'spotify' ? 'hidden' : ''}`}>
          <Icon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-white/40" />
          <input className="field rounded-full pl-12" placeholder="Song oder Interpret suchen" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {([['all', 'Alle Songs'], ['fav', 'Favoriten'], ['recent', 'Zuletzt gesungen'], ['spotify', 'Spotify (Mitsingen)']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} className={`chip ${tab === t ? 'chip-on' : ''}`} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {tab === 'spotify' ? <SpotifySearch /> : list.length === 0 ? (
        <div className="mt-16 text-center text-white/50">
          <Icon name="music" size={56} className="mx-auto mb-4 opacity-40" />
          <p className="text-xl font-semibold">{songs.length ? 'Nichts gefunden' : 'Noch keine Songs'}</p>
          <p className="mt-1">{tab === 'fav' ? 'Markiere Songs mit dem Herz.' : 'Füge MP3-, WAV-, M4A- oder FLAC-Dateien hinzu.'}</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
          {list.map((s) => (
            <SongCard key={s.id} song={s} best={best.get(s.id)} onPlay={() => play(s.id)} onQueue={() => enqueue(s.id)}
              onFav={() => void updateSong(s.id, { favorite: !s.favorite })} onEdit={() => setEdit(s.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function SongCard({ song, best, onPlay, onQueue, onFav, onEdit }: { song: Song; best?: number; onPlay(): void; onQueue(): void; onFav(): void; onEdit(): void }) {
  return (
    <div className="group rise">
      <div className="relative">
        <button onClick={onPlay} className="block w-full cursor-pointer transition duration-200 group-hover:-translate-y-1" aria-label={`${song.title} singen`}>
          <Cover song={song} />
          <span className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-within:opacity-100">
            <span className="grad flex h-16 w-16 items-center justify-center rounded-full shadow-xl"><Icon name="play" size={30} /></span>
          </span>
        </button>
        <button onClick={onFav} aria-label="Favorit" className={`absolute right-2 top-2 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-black/45 backdrop-blur transition hover:scale-110 ${song.favorite ? 'text-pink' : 'text-white/80'}`}><Icon name="heart" size={20} /></button>
        {best !== undefined && <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-bold backdrop-blur">★ {best}</span>}
        {!song.lyrics?.length && <button onClick={onEdit} className="absolute bottom-2 left-2 cursor-pointer rounded-full bg-yellow-300 px-2.5 py-1 text-xs font-bold text-black">Text fehlt</button>}
      </div>
      <div className="mt-3 flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{song.title}</p>
          <p className="truncate text-sm text-white/55">{song.artist} · {fmtTime(song.duration)}</p>
        </div>
        <button onClick={onQueue} title="Zur Warteschlange" aria-label="Zur Warteschlange" className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"><Icon name="queue" size={20} /></button>
        <button onClick={onEdit} title="Text & Details" aria-label="Text und Details bearbeiten" className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"><Icon name="edit" size={18} /></button>
      </div>
    </div>
  )
}
