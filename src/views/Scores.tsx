import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../ui'

export default function Scores() {
  const { scores, profiles, clearScores } = useStore()
  const [who, setWho] = useState('all')
  const list = useMemo(() => scores.filter((s) => who === 'all' || s.profileId === who).sort((a, b) => b.total - a.total || b.date - a.date).slice(0, 100), [scores, who])
  const medal = ['🥇', '🥈', '🥉']
  return (
    <div className="pb-10 pt-2">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-4 text-4xl font-black tracking-tight">Bestenliste</h1>
        <button className={`chip ${who === 'all' ? 'chip-on' : ''}`} onClick={() => setWho('all')}>Alle</button>
        {profiles.map((p) => <button key={p.id} className={`chip ${who === p.id ? 'chip-on' : ''}`} onClick={() => setWho(p.id)}>{p.name}</button>)}
        {scores.length > 0 && <button className="chip ml-auto" onClick={() => confirm('Alle Ergebnisse löschen?') && void clearScores()}>Zurücksetzen</button>}
      </div>
      {list.length === 0 ? (
        <div className="mt-16 text-center text-white/50"><Icon name="trophy" size={56} className="mx-auto mb-4 opacity-40" /><p className="text-xl font-semibold">Noch keine Ergebnisse</p><p className="mt-1">Sing einen Song mit Mikrofon bis zum Ende – dann landet er hier.</p></div>
      ) : (
        <ol className="mt-6 space-y-2">
          {list.map((s, i) => (
            <li key={s.id} className="glass rise flex items-center gap-4 rounded-2xl p-4" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
              <span className="w-10 text-center text-2xl font-black text-white/50">{medal[i] ?? i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{s.songTitle}</p>
                <p className="truncate text-sm text-white/55">{s.profileName} · {s.award} · {new Date(s.date).toLocaleDateString('de-DE')}</p>
              </div>
              <span className="hidden text-sm text-white/50 sm:block">{s.accuracy}% Treffer</span>
              <span className="grad-text w-16 text-right text-3xl font-black tabular-nums">{s.total}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
