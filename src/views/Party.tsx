import { useState } from 'react'
import { useStore } from '../store'
import { Cover, Icon } from '../ui'
import PhonePanel from './PhonePanel'
import { isConnected } from '../spotify/api'

export default function Party() {
  const { profiles, activeProfileId, setActiveProfile, addProfile, removeProfile, queue, songs, dequeue, moveQueue, setQueueSinger, playNext, go, scores, phones, setLibraryTab, settings } = useStore()
  const spotifyReady = !!settings.spotifyClientId && isConnected()
  const [name, setName] = useState('')
  const add = async () => { if (name.trim()) { await addProfile(name); setName('') } }
  const tonight = (id: string) => {
    const since = Date.now() - 12 * 3600 * 1000
    const s = scores.filter((x) => x.profileId === id && x.date > since)
    return s.length ? Math.round(s.reduce((a, b) => a + b.total, 0) / s.length) : null
  }
  const withPhone = new Set(phones.map((ph) => ph.pid))
  // verbundene Handys zuerst, dann alle, die heute schon gesungen haben oder von Hand angelegt wurden
  const people = [...profiles].sort((x, y) => Number(withPhone.has(y.id)) - Number(withPhone.has(x.id)))
  const pickSong = () => { setLibraryTab(spotifyReady ? 'spotify' : 'all'); go({ name: 'library' }) }
  return (
    <div className="grid gap-6 pb-10 pt-2 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="glass flex flex-col items-center justify-center p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[.25em] text-white/50">Mitsingen</p>
        <h2 className="mb-6 mt-1 text-center text-3xl font-black tracking-tight sm:text-4xl">Dein Handy ist das <span className="grad-text">Mikrofon</span></h2>
        <PhonePanel big />
      </section>

      <section className="glass flex flex-col p-6 sm:p-8">
        <div className="flex items-baseline gap-3">
          <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Wer ist dabei?</h2>
          <span className="text-lg font-semibold text-white/45">{withPhone.size ? `${withPhone.size} mit Handy` : 'Noch niemand verbunden'}</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {people.map((p) => {
            const avg = tonight(p.id), on = withPhone.has(p.id)
            return (
              <div key={p.id} data-testid={on ? 'phone-chip' : undefined} className={`group relative flex flex-col items-center rounded-3xl border p-4 text-center transition ${on ? 'pop border-emerald-300/50 bg-emerald-400/10' : p.id === activeProfileId ? 'border-white/40 bg-white/10' : 'border-white/10'}`}>
                <button className="flex w-full cursor-pointer flex-col items-center" onClick={() => setActiveProfile(p.id)} title="Als nächsten Sänger wählen">
                  <span className="relative flex h-16 w-16 items-center justify-center rounded-full text-2xl font-black text-black" style={{ background: p.color }}>
                    {p.name.slice(0, 1).toUpperCase()}
                    {on && <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400 text-black ring-4 ring-panel"><Icon name="mic" size={15} /></span>}
                  </span>
                  <span className="mt-2 w-full truncate text-lg font-bold">{p.name}</span>
                  <span className="text-xs text-white/50">{on ? 'Handy verbunden' : avg !== null ? `Ø ${avg} Punkte heute` : 'ohne Handy'}</span>
                </button>
                {profiles.length > 1 && !on && <button className="absolute right-1.5 top-1.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-white/30 opacity-0 transition hover:bg-white/10 hover:text-white group-hover:opacity-100 focus:opacity-100" aria-label={`${p.name} entfernen`} onClick={() => void removeProfile(p.id)}><Icon name="close" size={14} /></button>}
              </div>
            )
          })}
        </div>
        <details className="mt-4 text-white/60">
          <summary className="cursor-pointer text-sm font-semibold hover:text-white">Jemand ohne Handy? Namen von Hand hinzufügen</summary>
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
            <input className="field" placeholder="Name hinzufügen" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} />
            <button className="btn shrink-0" disabled={!name.trim()}><Icon name="plus" />Hinzufügen</button>
          </form>
          <p className="mt-2 text-sm text-white/45">Wer kein Handy verbindet, singt in das Mikrofon dieses Geräts – dann abwechselnd statt gleichzeitig.</p>
        </details>
        <div className="mt-auto pt-6">
          <button data-testid="pick-song" className="btn-primary w-full py-5 text-xl" onClick={pickSong}><Icon name="music" />Song aussuchen</button>
          <p className="mt-2 text-center text-sm text-white/45">{withPhone.size >= 2 ? 'Alle verbundenen Handys singen gleichzeitig – jeder mit eigener Notenbahn.' : 'Ab zwei verbundenen Handys singen alle gleichzeitig.'}</p>
        </div>
      </section>

      <section className="glass p-6 sm:p-8 lg:col-span-2">
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
