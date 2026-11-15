import { useEffect, useState } from 'react'
import { useStore, type View } from '../store'
import { Cover, Icon, Stars } from '../ui'

const PARTS: [keyof Extract<View, { name: 'results' }>['result']['parts'], string, string][] = [
  ['pitch', 'Tonhöhe', 'Wie genau du die Töne der Originalmelodie triffst'],
  ['rhythm', 'Rhythmus', 'Singen, wenn gesungen wird – Pause, wenn Pause ist'],
  ['timing', 'Einsatz', 'Wie pünktlich du in jede Phrase einsteigst'],
  ['continuity', 'Kontinuität', 'Phrasen durchsingen statt abbrechen'],
]

export default function Results({ view }: { view: Extract<View, { name: 'results' }> }) {
  const { songs, profiles, queue, play, playNext, go } = useStore()
  const song = songs.find((s) => s.id === view.songId)
  const profile = profiles.find((p) => p.id === view.profileId)
  const r = view.result
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!view.micUsed) return
    const t0 = performance.now()
    let raf = 0
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / 1600)
      setN(Math.round(r.total * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [r.total, view.micUsed])
  if (!song) return null
  const next = queue[0] && songs.find((s) => s.id === queue[0].songId)
  const nextSinger = queue[0] && profiles.find((p) => p.id === queue[0].profileId)
  const C = 2 * Math.PI * 88

  return (
    <div className="mx-auto flex min-h-full max-w-6xl flex-col items-center justify-center gap-8 p-6 lg:flex-row lg:gap-16">
      <div className="flex flex-col items-center text-center">
        <Cover song={song} className="w-28 rounded-xl lg:w-36" />
        <p className="mt-3 text-xl font-bold">{song.title}</p>
        <p className="text-white/55">{profile?.name}</p>
        {view.micUsed ? (
          <>
            <div className="pop relative mt-6 h-64 w-64 lg:h-80 lg:w-80">
              <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90">
                <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ff3d81" /><stop offset=".55" stopColor="#a855f7" /><stop offset="1" stopColor="#38bdf8" /></linearGradient></defs>
                <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(255,255,255,.1)" strokeWidth="12" />
                <circle cx="100" cy="100" r="88" fill="none" stroke="url(#rg)" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - n / 100)} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span data-testid="total" className="text-8xl font-black tabular-nums tracking-tighter lg:text-9xl">{n}</span>
                <span className="text-sm font-semibold uppercase tracking-[.3em] text-white/50">von 100</span>
              </div>
            </div>
            <div className="mt-5"><Stars value={r.stars} size={40} /></div>
          </>
        ) : (
          <div className="glass mt-6 max-w-sm p-6"><Icon name="micOff" size={40} className="mx-auto mb-2 text-white/50" /><p className="text-lg font-bold">Ohne Mikrofon gesungen</p><p className="mt-1 text-white/60">Für eine Bewertung beim nächsten Song das Mikrofon aktivieren.</p></div>
        )}
      </div>

      <div className="w-full max-w-xl">
        {view.micUsed && (
          <>
            <div className="rise text-center lg:text-left" style={{ animationDelay: '1.2s' }}>
              <p className="text-6xl">{r.award.emoji}</p>
              <h1 className="grad-text mt-1 text-5xl font-black tracking-tight lg:text-6xl">{r.award.title}</h1>
              <p className="mt-2 text-xl text-white/70">{r.award.text}</p>
              <p className="mt-1 text-white/50">
                <span data-testid="accuracy">{r.accuracy}</span> % der gesungenen Töne getroffen
                {view.rank ? ` · Platz ${view.rank} bei diesem Song` : ''}
              </p>
              {!r.valid && <p className="mt-2 rounded-xl bg-yellow-300/15 px-3 py-2 text-sm text-yellow-200">{r.played < 0.5 ? 'Song nicht zu Ende gesungen – zählt nicht für die Bestenliste.' : 'In diesem Song wurde keine klare Gesangsmelodie erkannt – Bewertung ohne Gewähr.'}</p>}
            </div>
            <div className="mt-6 space-y-4">
              {PARTS.map(([k, label, hint], i) => (
                <div key={k} className="rise" style={{ animationDelay: `${0.3 + i * 0.15}s` }}>
                  <div className="flex items-baseline justify-between"><span className="text-lg font-bold">{label}</span><span data-testid={`part-${k}`} className="text-lg font-black tabular-nums">{r.parts[k]}</span></div>
                  <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/10"><div className="grad h-full rounded-full transition-[width] duration-1000 ease-out" style={{ width: `${n ? r.parts[k] : 0}%` }} /></div>
                  <p className="mt-1 text-sm text-white/45">{hint}</p>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          {next && <button className="btn-primary flex-1 px-7 py-4 text-lg" onClick={() => playNext()}><Icon name="skip" />Weiter: {nextSinger?.name} – {next.title}</button>}
          <button className={`${next ? 'btn' : 'btn-primary'} px-7 py-4 text-lg`} onClick={() => play(song.id, view.profileId)}><Icon name="restart" />Nochmal</button>
          <button className="btn px-7 py-4 text-lg" onClick={() => go({ name: 'library' })}><Icon name="music" />Bibliothek</button>
        </div>
      </div>
    </div>
  )
}
