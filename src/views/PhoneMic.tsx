import { useEffect, useRef, useState } from 'react'
import { Mic } from '../audio/mic'
import { midiToName } from '../lib/pitch'
import { joinHost, type ClientLink } from '../remote/link'
import { Icon } from '../ui'

type State = 'idle' | 'starting' | 'on' | 'lost' | 'error'

/** Handy als Funkmikrofon: erkennt die Tonhöhe auf dem Handy und schickt nur diese Werte an die Karaoke-App. */
export default function PhoneMic({ code }: { code: string }) {
  const [name, setName] = useState(() => localStorage.getItem('encore-phone-name') || '')
  const [state, setState] = useState<State>('idle')
  const [error, setError] = useState('')
  const [view, setView] = useState({ note: '', level: 0 })
  const [color, setColor] = useState('#a855f7')
  const [turn, setTurn] = useState({ you: false, song: '' })
  const link = useRef<ClientLink | null>(null)
  const micRef = useRef<Mic | null>(null)
  const alive = useRef(true)

  useEffect(() => () => { alive.current = false; link.current?.close(); micRef.current?.stop() }, [])

  const connect = async (who: string) => {
    link.current?.close()
    link.current = await joinHost(code, { name: who }, (s) => {
      if (s === 'open') setState('on')
      else if (alive.current) { setState('lost'); setTimeout(() => { if (alive.current) void connect(who).catch(() => {}) }, 2500) } // von selbst neu verbinden
    }, (m) => { if (m.k === 'w') setColor(m.color); else if (m.k === 't') setTurn({ you: m.you, song: m.song }) })
  }

  const start = async () => {
    const who = name.trim() || 'Gast'
    setState('starting'); setError('')
    try {
      localStorage.setItem('encore-phone-name', who)
      const ctx = new AudioContext()
      await ctx.resume()
      const m = new Mic()
      await m.start(ctx, 'headphones') // unbearbeitetes Signal: das Handy ist nah am Mund
      micRef.current = m
      await connect(who)
      navigator.wakeLock?.request('screen').catch(() => {})
      let n = 0
      setInterval(() => {
        const s = m.sample()
        link.current?.send({ k: 'p', m: s.voiced ? Math.round(s.midi * 100) / 100 : 0, l: Math.round(s.level * 100) / 100, r: Math.round((s.rms ?? 0) * 10000) / 10000 })
        if (++n % 4 === 0) setView({ note: s.voiced ? midiToName(s.midi) : '', level: s.level })
      }, 40)
    } catch (e) {
      const msg = (e as Error).name === 'NotAllowedError' ? 'Ohne Mikrofon-Erlaubnis geht es nicht. Bitte in den Browser-Einstellungen erlauben und die Seite neu laden.' : (e as Error).message
      setError(msg); setState('error')
    }
  }

  const joined = state === 'on' || state === 'lost'
  const who = name.trim() || 'Gast'
  // war dieses Handy schon einmal dabei? Dann genügt ein Tipp (den verlangt der Browser fürs Mikrofon)
  const [known] = useState(() => !!localStorage.getItem('encore-phone-name'))
  const [edit, setEdit] = useState(false)
  return (
    <div className="relative flex min-h-full flex-col items-center overflow-hidden px-6 pb-8 pt-10 text-center">
      <div className="pointer-events-none absolute -top-40 h-96 w-96 rounded-full opacity-40 blur-3xl transition-colors duration-700" style={{ background: joined ? color : '#a855f7' }} />
      <div className="relative flex items-center gap-2.5 text-white/80"><span className="grad flex h-9 w-9 items-center justify-center rounded-xl"><Icon name="mic" size={18} /></span><span className="text-xl font-black tracking-tight">Encore</span></div>

      {!joined ? (
        <div className="relative flex w-full max-w-sm flex-1 flex-col justify-center">
          <h1 className="text-4xl font-black leading-tight tracking-tight">{known && !edit ? <>Willkommen zurück, <span className="grad-text">{who}</span></> : <>Dein Handy wird zum <span className="grad-text">Mikrofon</span></>}</h1>
          {known && !edit ? (
            <>
              <button data-testid="phone-continue" className="btn-primary mt-6 w-full py-6 text-2xl" disabled={state === 'starting'} onClick={() => void start()}>{state === 'starting' ? 'Verbinde …' : 'Weiter singen'}</button>
              <button className="mt-3 cursor-pointer text-sm font-semibold text-white/50 underline" onClick={() => setEdit(true)}>Nicht {who}? Namen ändern</button>
            </>
          ) : <p className="mt-3 text-lg text-white/60">Wie heißt du?</p>}
          <form className={`mt-4 ${known && !edit ? 'hidden' : ''}`} onSubmit={(e) => { e.preventDefault(); if (name.trim() && state !== 'starting') void start() }}>
            <input autoFocus className="field py-4 text-center text-2xl font-bold" placeholder="Dein Name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
            <button data-testid="phone-start" className="btn-primary mt-4 w-full py-5 text-xl" disabled={state === 'starting' || !name.trim()}>{state === 'starting' ? 'Verbinde …' : 'Mitsingen'}</button>
          </form>
          {error && <p className="mt-4 rounded-2xl bg-red-500/15 p-3 text-red-200">{error}</p>}
          <p className="mt-6 text-sm leading-relaxed text-white/45">Gleich fragt dein Handy nach dem Mikrofon – bitte erlauben. Dein Gesang wird nur auf diesem Handy ausgewertet, nicht aufgenommen und nicht übertragen.</p>
        </div>
      ) : (
        <div className="relative flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6">
          <div className="flex h-60 w-60 flex-col items-center justify-center rounded-full border-[6px] transition-shadow duration-100"
            style={{ borderColor: state === 'lost' ? 'rgba(248,113,113,.6)' : color, boxShadow: state === 'on' ? `0 0 ${24 + view.level * 140}px ${color}` : undefined }}>
            <span data-testid="phone-note" className="text-7xl font-black tabular-nums leading-none">{view.note || '♪'}</span>
            <span className="mt-2 max-w-44 truncate text-xl font-bold" style={{ color }}>{who}</span>
          </div>
          <div>
            <p data-testid="phone-state" className="text-2xl font-black">
              {state === 'lost' ? 'Verbindung wird wiederhergestellt …' : turn.you ? 'Du singst!' : turn.song ? 'Gleich bist du dran' : 'Du bist dabei!'}
            </p>
            <p className="mt-1 text-white/60">{state === 'lost' ? 'Einen Moment bitte.' : turn.song ? turn.song : 'Sobald ein Song startet, geht es los.'}</p>
          </div>
          <ul className="space-y-1.5 text-left text-sm text-white/50">
            <li>🎤 Handy wie ein Mikrofon nah an den Mund</li>
            <li>📱 Diese Seite offen und den Bildschirm an lassen</li>
          </ul>
        </div>
      )}
    </div>
  )
}
