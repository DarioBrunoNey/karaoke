import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { Icon } from '../ui'

/** QR-Code und Liste der verbundenen Handy-Mikrofone */
export default function PhonePanel({ compact }: { compact?: boolean }) {
  const { phoneHost, phones, startPhones, profiles } = useStore()
  const [qr, setQr] = useState('')
  useEffect(() => {
    if (!phoneHost.url) return
    void import('qrcode').then((Q) => Q.toDataURL(phoneHost.url, { margin: 1, width: 360, color: { dark: '#0b0714', light: '#ffffff' } })).then(setQr)
  }, [phoneHost.url])

  if (phoneHost.state === 'off' || phoneHost.state === 'error') return (
    <div>
      <p className="text-white/60">Jeder Sänger nutzt sein eigenes Handy als Funkmikrofon – für gleichzeitiges Singen und für den Fernseher. Übertragen wird nur die erkannte Tonhöhe, kein Ton.</p>
      {phoneHost.error && <p className="mt-2 rounded-xl bg-red-500/15 p-3 text-red-200">{phoneHost.error}. Bitte Internetverbindung prüfen und erneut versuchen.</p>}
      <button data-testid="phones-start" className="btn-primary mt-3" onClick={() => void startPhones()}><Icon name="mic" size={20} />Handys als Mikrofon verbinden</button>
    </div>
  )
  if (phoneHost.state === 'starting') return <p className="text-white/60">Verbindung wird vorbereitet …</p>
  return (
    <div className={`flex gap-5 ${compact ? 'items-center' : 'flex-col items-center sm:flex-row sm:items-start'}`}>
      {qr && <img src={qr} alt="QR-Code für das Handy-Mikrofon" className={`rounded-2xl ${compact ? 'h-32 w-32' : 'h-48 w-48'}`} />}
      <div className="min-w-0 flex-1">
        <p className="font-bold">Mit der Handy-Kamera scannen, Namen eingeben, „Mikrofon starten“.</p>
        <p data-testid="phone-url" className="mt-1 select-all break-all font-mono text-xs text-white/45">{phoneHost.url}</p>
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
