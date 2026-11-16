import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../ui'

/** QR-Code zum Verbinden der Handy-Mikrofone. `big` = Lobby-Darstellung, `compact` = im Dialog. */
export default function PhonePanel({ compact, big, auto }: { compact?: boolean; big?: boolean; /** Verbindung ohne Knopfdruck vorbereiten */ auto?: boolean }) {
  const { phoneHost, phones, startPhones, profiles } = useStore()
  const [qr, setQr] = useState('')
  useEffect(() => { if (big || auto) void startPhones() }, [big, auto, startPhones])
  useEffect(() => {
    if (!phoneHost.url) return
    void import('qrcode').then((Q) => Q.toDataURL(phoneHost.url, { margin: 1, width: 520, color: { dark: '#0b0714', light: '#ffffff' } })).then(setQr)
  }, [phoneHost.url])

  if (phoneHost.state === 'error' || (phoneHost.state === 'off' && !big && !auto)) return (
    <div className={big ? 'text-center' : ''}>
      {!big && <p className="text-white/60">Jeder Sänger nutzt sein eigenes Handy als Funkmikrofon – für gleichzeitiges Singen und für den Fernseher. Übertragen wird nur die erkannte Tonhöhe, kein Ton.</p>}
      {phoneHost.error && <p className="mt-2 rounded-xl bg-red-500/15 p-3 text-red-200">Keine Verbindung zum Vermittlungsdienst ({phoneHost.error}). Bitte Internet prüfen.</p>}
      <button data-testid="phones-start" className="btn-primary mt-3" onClick={() => void startPhones()}><Icon name="mic" size={20} />{phoneHost.error ? 'Erneut versuchen' : 'Handys als Mikrofon verbinden'}</button>
    </div>
  )
  if (phoneHost.state !== 'on') return <div className={`flex items-center justify-center text-white/50 ${big ? 'h-72' : ''}`}>QR-Code wird vorbereitet …</div>

  if (big) return (
    <div className="flex flex-col items-center text-center">
      <div className="rounded-[2rem] bg-white p-4 shadow-2xl shadow-violet-500/30">{qr ? <img src={qr} alt="QR-Code für das Handy-Mikrofon" className="h-64 w-64 sm:h-72 sm:w-72 2xl:h-96 2xl:w-96" /> : <div className="h-64 w-64 sm:h-72 sm:w-72" />}</div>
      <ol className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-lg font-semibold text-white/80">
        {['Handy-Kamera öffnen', 'Code scannen', 'Namen eingeben'].map((t, i) => <li key={t} className="flex items-center gap-2"><span className="grad flex h-7 w-7 items-center justify-center rounded-full text-sm font-black">{i + 1}</span>{t}</li>)}
      </ol>
      <p data-testid="phone-url" className="mt-3 max-w-full select-all break-all font-mono text-[11px] text-white/25">{phoneHost.url}</p>
    </div>
  )
  return (
    <div className={`flex gap-5 ${compact ? 'items-center' : 'flex-col items-center sm:flex-row sm:items-start'}`}>
      {qr && <img src={qr} alt="QR-Code für das Handy-Mikrofon" className={`rounded-2xl ${compact ? 'h-32 w-32' : 'h-48 w-48'}`} />}
      <div className="min-w-0 flex-1">
        <p className="font-bold">Mit der Handy-Kamera scannen, Namen eingeben, „Mitsingen“.</p>
        <p data-testid="phone-url" className="mt-1 select-all break-all font-mono text-xs text-white/35">{phoneHost.url}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {phones.length === 0 && <span className="text-white/50">Noch kein Handy verbunden.</span>}
          {phones.map((ph) => {
            const pr = profiles.find((x) => x.id === ph.pid)
            return <span key={ph.cid} data-testid="phone-chip" className="flex items-center gap-2 rounded-full bg-emerald-400/15 py-1 pl-1 pr-3 font-semibold text-emerald-200"><span className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-black text-black" style={{ background: pr?.color }}>{ph.name.slice(0, 1).toUpperCase()}</span>{ph.name}</span>
          })}
        </div>
      </div>
    </div>
  )
}
