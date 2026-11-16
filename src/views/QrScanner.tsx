import { useEffect, useRef, useState } from 'react'
import { Icon, Modal } from '../ui'

/** Liest aus einem gescannten Text den Mikrofon-Code (…?mic=CODE) */
export const micCodeFrom = (text: string) => text.match(/[?&]mic=([a-z0-9]{4,12})/i)?.[1] ?? null

/**
 * QR-Code mit der Handy-Kamera scannen, direkt in der App – um (wieder) als Mikrofon beizutreten.
 * Nutzt die eingebaute Erkennung des Browsers, wo vorhanden, sonst eine mitgelieferte Bibliothek.
 * Das Kamerabild bleibt auf dem Gerät.
 */
export default function QrScanner({ onClose }: { onClose(): void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [msg, setMsg] = useState('Kamera wird gestartet …')
  const [err, setErr] = useState('')

  useEffect(() => {
    let stream: MediaStream | null = null
    let timer = 0
    let stop = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return }
        const v = video.current!
        v.srcObject = stream
        await v.play()
        setMsg('Halte die Kamera auf den QR-Code am großen Bildschirm')
        const BD = (window as any).BarcodeDetector
        const native = BD ? new BD({ formats: ['qr_code'] }) : null
        const jsqr = native ? null : (await import('jsqr')).default
        const canvas = document.createElement('canvas')
        const read = async (): Promise<string> => {
          if (v.readyState < 2 || !v.videoWidth) return ''
          if (native) { const r = await native.detect(v).catch(() => []); return r[0]?.rawValue ?? '' }
          const scale = Math.min(1, 800 / v.videoWidth)
          canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale)
          const g = canvas.getContext('2d', { willReadFrequently: true })!
          g.drawImage(v, 0, 0, canvas.width, canvas.height)
          const img = g.getImageData(0, 0, canvas.width, canvas.height)
          return jsqr!(img.data, img.width, img.height)?.data ?? ''
        }
        const tick = async () => {
          if (stop) return
          const text = await read()
          if (text) {
            const code = micCodeFrom(text)
            if (code) {
              stop = true
              // immer auf der eigenen Adresse bleiben – nur der Code wird aus dem QR übernommen
              location.assign(`${location.origin}${location.pathname}?mic=${code}${new URLSearchParams(location.search).has('bc') ? '&bc' : ''}`)
              return
            }
            setMsg('Das ist kein Encore-Code. Bitte den QR-Code aus der Karaoke-App scannen.')
          }
          timer = window.setTimeout(tick, 220)
        }
        void tick()
      } catch (e) {
        setErr((e as Error).name === 'NotAllowedError' ? 'Ohne Kamera-Erlaubnis geht das Scannen nicht. Bitte im Browser erlauben – oder den QR-Code mit der normalen Kamera-App scannen.' : 'Die Kamera konnte nicht gestartet werden. Bitte den QR-Code mit der normalen Kamera-App scannen.')
      }
    })()
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()) }
  }, [])

  return (
    <Modal onClose={onClose}>
      <div className="flex items-start gap-4">
        <h2 className="flex-1 text-3xl font-black tracking-tight">QR-Code scannen</h2>
        <button className="btn-icon" onClick={onClose} aria-label="Schließen"><Icon name="close" /></button>
      </div>
      {err ? <p className="mt-4 rounded-2xl bg-red-500/15 p-4 text-red-200">{err}</p> : (
        <>
          <div className="relative mt-4 aspect-square overflow-hidden rounded-3xl bg-black">
            <video ref={video} playsInline muted className="h-full w-full object-cover" />
            <div className="pointer-events-none absolute inset-[14%] rounded-3xl border-4 border-white/80 shadow-[0_0_0_100vmax_rgba(0,0,0,.35)]" />
          </div>
          <p data-testid="scan-msg" className="mt-4 text-center text-lg font-semibold text-white/80">{msg}</p>
        </>
      )}
      <p className="mt-3 text-center text-sm text-white/45">Das Kamerabild wird nur auf diesem Gerät ausgewertet.</p>
    </Modal>
  )
}
