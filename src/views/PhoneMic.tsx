import { useEffect, useRef, useState } from 'react'
import { Mic } from '../audio/mic'
import { midiToName } from '../lib/pitch'
import { joinHost, type ClientLink } from '../remote/link'
import { Icon } from '../ui'

/** Handy als Funkmikrofon: erkennt die Tonhöhe auf dem Handy und schickt nur diese Werte an die Karaoke-App. */
export default function PhoneMic({ code }: { code: string }) {
  const [name, setName] = useState(() => localStorage.getItem('encore-phone-name') || '')
  const [state, setState] = useState<'idle' | 'starting' | 'on' | 'closed' | 'error'>('idle')
  const [error, setError] = useState('')
  const [view, setView] = useState({ note: '', level: 0 })
  const link = useRef<ClientLink | null>(null)
  const micRef = useRef<Mic | null>(null)

  useEffect(() => () => { link.current?.close(); micRef.current?.stop() }, [])

  const start = async () => {
    setState('starting'); setError('')
    try {
      localStorage.setItem('encore-phone-name', name.trim())
      const ctx = new AudioContext()
      await ctx.resume()
      const m = new Mic()
      await m.start(ctx, 'headphones') // unbearbeitetes Signal: das Handy ist nah am Mund
      micRef.current = m
      link.current = await joinHost(code, { name: name.trim() || 'Gast' }, (s) => setState(s === 'open' ? 'on' : 'closed'))
      navigator.wakeLock?.request('screen').catch(() => {})
      let n = 0
      setInterval(() => {
        const s = m.sample()
        link.current?.send({ k: 'p', m: s.voiced ? Math.round(s.midi * 100) / 100 : 0, l: Math.round(s.level * 100) / 100 })
        if (++n % 4 === 0) setView({ note: s.voiced ? midiToName(s.midi) : '', level: s.level })
      }, 40)
    } catch (e) {
      const msg = (e as Error).name === 'NotAllowedError' ? 'Ohne Mikrofon-Erlaubnis geht es nicht. Bitte in den Browser-Einstellungen erlauben und neu laden.' : (e as Error).message
      setError(msg); setState('error')
    }
  }

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex items-center gap-3"><span className="grad flex h-12 w-12 items-center justify-center rounded-2xl"><Icon name="mic" /></span><span className="text-3xl font-black tracking-tight">Encore-Mikrofon</span></div>
      {state === 'on' || state === 'closed' ? (
        <>
          <div className={`flex h-56 w-56 flex-col items-center justify-center rounded-full border-4 transition ${state === 'closed' ? 'border-red-400/60' : 'border-emerald-300'}`} style={{ boxShadow: state === 'on' ? `0 0 ${20 + view.level * 120}px rgba(52,211,153,${0.2 + view.level * 0.6})` : undefined }}>
            <span data-testid="phone-note" className="text-6xl font-black tabular-nums">{view.note || '♪'}</span>
            <span className="mt-1 text-white/60">{name || 'Gast'}</span>
          </div>
          <p data-testid="phone-state" className="text-xl font-bold">{state === 'on' ? 'Verbunden – sing ins Handy!' : 'Verbindung getrennt'}</p>
          <p className="max-w-xs text-white/55">{state === 'on' ? 'Halte das Handy wie ein Mikrofon nah an den Mund. Bildschirm anlassen. Es wird kein Ton übertragen, nur die erkannte Tonhöhe.' : 'Seite neu laden und noch einmal verbinden.'}</p>
        </>
      ) : (
        <>
          <p className="max-w-sm text-lg text-white/65">Dein Handy wird zum Mikrofon für die Karaoke-App auf dem großen Bildschirm.</p>
          <input className="field max-w-xs text-center text-xl" placeholder="Dein Name" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          <button data-testid="phone-start" className="btn-primary px-10 py-5 text-xl" disabled={state === 'starting' || !name.trim()} onClick={() => void start()}>{state === 'starting' ? 'Verbinde …' : 'Mikrofon starten'}</button>
          {error && <p className="max-w-sm rounded-2xl bg-red-500/15 p-3 text-red-200">{error}</p>}
          <p className="max-w-xs text-sm text-white/45">Gleich fragt der Browser nach dem Mikrofon. Dein Gesang wird nur auf diesem Handy analysiert und nicht aufgenommen.</p>
        </>
      )}
    </div>
  )
}
