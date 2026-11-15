import { useEffect, useState } from 'react'
import { useStore } from './store'
import { Icon } from './ui'
import Library from './views/Library'
import Party from './views/Party'
import Scores from './views/Scores'
import Info from './views/Info'
import Player from './views/Player'
import Results from './views/Results'
import SpotifyPlayer from './views/SpotifyPlayer'
import SongDialog from './views/SongDialog'

const NAV = [
  { name: 'library', label: 'Bibliothek', icon: 'music' },
  { name: 'party', label: 'Karaoke-Abend', icon: 'users' },
  { name: 'scores', label: 'Bestenliste', icon: 'trophy' },
  { name: 'info', label: 'Hilfe & Musikquellen', icon: 'info' },
] as const

export default function App() {
  const { ready, view, go, init, toast, editSongId, queue, profiles, activeProfileId, importFiles } = useStore()
  const [drag, setDrag] = useState(false)
  useEffect(() => { void init() }, [init])

  if (!ready) return <div className="flex h-full items-center justify-center"><div className="grad-text text-4xl font-black tracking-tight">Encore</div></div>
  if (view.name === 'player') return <><Player key={view.run} songId={view.songId} profileId={view.profileId} /><Toast msg={toast} /></>
  if (view.name === 'spotify') return <><SpotifyPlayer key={view.run} track={view.track} profileId={view.profileId} /><Toast msg={toast} /></>
  if (view.name === 'results') return <Results view={view} />

  const active = profiles.find((p) => p.id === activeProfileId)
  return (
    <div className="mx-auto flex min-h-full max-w-[1800px] flex-col pb-24 lg:pb-0"
      onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void importFiles([...e.dataTransfer.files]) }}>
      <header className="sticky top-0 z-30 flex items-center gap-4 bg-ink/70 px-5 py-4 backdrop-blur-xl sm:px-8">
        <button className="flex cursor-pointer items-center gap-3" onClick={() => go({ name: 'library' })}>
          <span className="grad flex h-11 w-11 items-center justify-center rounded-2xl shadow-lg shadow-pink-500/30"><Icon name="mic" /></span>
          <span className="text-2xl font-black tracking-tight">Encore</span>
        </button>
        <nav className="ml-6 hidden gap-1 lg:flex">
          {NAV.map((n) => (
            <button key={n.name} onClick={() => go({ name: n.name })}
              className={`flex cursor-pointer items-center gap-2 rounded-full px-4 py-2.5 font-semibold transition ${view.name === n.name ? 'bg-white text-black' : 'text-white/70 hover:bg-white/10'}`}>
              <Icon name={n.icon} size={18} />{n.label}
              {n.name === 'party' && queue.length > 0 && <span className="grad rounded-full px-2 text-xs text-white">{queue.length}</span>}
            </button>
          ))}
        </nav>
        <button className="ml-auto flex cursor-pointer items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1.5 pl-1.5 pr-4 font-semibold hover:bg-white/10" onClick={() => go({ name: 'party' })} title="Sänger wechseln">
          <span className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-black text-black" style={{ background: active?.color }}>{active?.name.slice(0, 1).toUpperCase()}</span>
          <span className="max-w-32 truncate">{active?.name}</span>
        </button>
      </header>

      <main className="flex-1 px-5 sm:px-8">
        {view.name === 'library' && <Library />}
        {view.name === 'party' && <Party />}
        {view.name === 'scores' && <Scores />}
        {view.name === 'info' && <Info />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-white/10 bg-ink/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        {NAV.map((n) => (
          <button key={n.name} onClick={() => go({ name: n.name })} className={`relative flex flex-1 cursor-pointer flex-col items-center gap-1 py-3 text-[11px] font-semibold ${view.name === n.name ? 'text-white' : 'text-white/50'}`}>
            <Icon name={n.icon} />{n.label.split(' ')[0]}
            {n.name === 'party' && queue.length > 0 && <span className="grad absolute right-1/4 top-2 rounded-full px-1.5 text-[10px] text-white">{queue.length}</span>}
          </button>
        ))}
      </nav>

      {drag && <div className="pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-[2rem] border-4 border-dashed border-pink bg-ink/80 text-3xl font-black backdrop-blur">Songs hier ablegen</div>}
      {editSongId && <SongDialog songId={editSongId} />}
      <Toast msg={toast} />
    </div>
  )
}

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null
  return <div className="rise fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-white px-6 py-3 font-semibold text-black shadow-2xl lg:bottom-8">{msg}</div>
}
