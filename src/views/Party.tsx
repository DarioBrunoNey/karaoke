import { useState } from 'react'
import { useStore } from '../store'
import { Cover, Icon } from '../ui'

export default function Party() {
  const { profiles, activeProfileId, setActiveProfile, addProfile, removeProfile, queue, songs, dequeue, moveQueue, setQueueSinger, playNext, go, scores } = useStore()
  const [name, setName] = useState('')
  const add = async () => { if (name.trim()) { await addProfile(name); setName('') } }
  const tonight = (id: string) => {
    const since = Date.now() - 12 * 3600 * 1000
    const s = scores.filter((x) => x.profileId === id && x.date > since)
    return s.length ? Math.round(s.reduce((a, b) => a + b.total, 0) / s.length) : null
  }
  return (
    <div className="grid gap-6 pb-10 pt-2 lg:grid-cols-2">
      <section className="glass p-6 sm:p-8">
        <h2 className="text-3xl font-black tracking-tight">Sänger</h2>
        <p className="mt-1 text-white/55">Wer ist dabei? Der markierte Sänger ist als Nächstes dran. Neue Warteschlangen-Einträge werden reihum verteilt.</p>
        <div className="mt-5 space-y-2">
          {profiles.map((p) => {
            const avg = tonight(p.id)
            return (
              <div key={p.id} className={`flex items-center gap-3 rounded-2xl border p-3 transition ${p.id === activeProfileId ? 'border-white/40 bg-white/10' : 'border-white/10'}`}>
                <button className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left" onClick={() => setActiveProfile(p.id)}>
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-xl font-black text-black" style={{ background: p.color }}>{p.name.slice(0, 1).toUpperCase()}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-lg font-bold">{p.name}</span>
                    <span className="text-sm text-white/50">{avg !== null ? `Ø ${avg} Punkte heute` : 'Noch kein Auftritt heute'}</span>
                  </span>
                </button>
                {p.id === activeProfileId && <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-black">Aktiv</span>}
                {profiles.length > 1 && <button className="btn-icon h-10 w-10 bg-transparent text-white/50" aria-label={`${p.name} entfernen`} onClick={() => void removeProfile(p.id)}><Icon name="close" size={18} /></button>}
              </div>
            )
          })}
        </div>
        <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <input className="field" placeholder="Name hinzufügen" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
          <button className="btn-primary shrink-0" disabled={!name.trim()}><Icon name="plus" />Hinzufügen</button>
        </form>
      </section>

      <section className="glass p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-black tracking-tight">Warteschlange</h2>
          {queue.length > 0 && <button className="btn-primary ml-auto" onClick={() => playNext()}><Icon name="play" />Starten</button>}
        </div>
        {queue.length === 0 ? (
          <div className="mt-8 text-center text-white/50">
            <p className="text-lg font-semibold">Die Bühne ist frei</p>
            <p className="mt-1">Füge Songs in der Bibliothek über das Listen-Symbol hinzu.</p>
            <button className="btn mt-5" onClick={() => go({ name: 'library' })}><Icon name="music" />Zur Bibliothek</button>
          </div>
        ) : (
          <ol className="mt-5 space-y-2">
            {queue.map((qi, i) => {
              const song = songs.find((s) => s.id === qi.songId)
              if (!song && !qi.spotify) return null
              return (
                <li key={qi.qid} className="flex items-center gap-3 rounded-2xl border border-white/10 p-2.5">
                  <span className="w-6 text-center text-lg font-black text-white/40">{i + 1}</span>
                  {song ? <Cover song={song} className="w-14 shrink-0 rounded-xl" /> : <img src={qi.spotify!.coverSmall || qi.spotify!.cover} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{song ? song.title : qi.spotify!.name}{qi.spotify && <span className="ml-2 rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">Spotify</span>}</p>
                    <select aria-label="Sänger" className="mt-0.5 max-w-full cursor-pointer rounded-lg bg-white/10 px-2 py-1 text-sm" value={qi.profileId} onChange={(e) => setQueueSinger(qi.qid, e.target.value)}>
                      {profiles.map((p) => <option key={p.id} value={p.id} className="text-black">{p.name}</option>)}
                    </select>
                  </div>
                  <button className="btn-icon h-10 w-10 bg-transparent" aria-label="Nach oben" disabled={i === 0} onClick={() => moveQueue(qi.qid, -1)}><Icon name="up" size={18} /></button>
                  <button className="btn-icon h-10 w-10 bg-transparent" aria-label="Nach unten" disabled={i === queue.length - 1} onClick={() => moveQueue(qi.qid, 1)}><Icon name="down" size={18} /></button>
                  <button className="btn-icon h-10 w-10 bg-transparent text-white/50" aria-label="Entfernen" onClick={() => dequeue(qi.qid)}><Icon name="close" size={18} /></button>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
