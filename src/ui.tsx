import { useEffect, useMemo, type ReactNode } from 'react'
import type { Song } from './lib/types'

const P: Record<string, string> = {
  play: 'M8 5v14l11-7z', pause: 'M6 5h4v14H6zM14 5h4v14h-4z',
  heart: 'M12 21s-7.5-4.6-9.6-9.2C.9 8.5 2.7 5 6.3 5c2 0 3.6 1 4.7 2.7h2C14.1 6 15.7 5 17.7 5c3.6 0 5.4 3.5 3.9 6.8C19.5 16.4 12 21 12 21z',
  plus: 'M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z', close: 'M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z',
  queue: 'M4 6h12v2H4zm0 5h12v2H4zm0 5h8v2H4zm14-5v6l5-3z', mic: 'M12 15a4 4 0 0 0 4-4V6a4 4 0 1 0-8 0v5a4 4 0 0 0 4 4zm7-4a7 7 0 0 1-6 6.9V21h-2v-3.1A7 7 0 0 1 5 11h2a5 5 0 0 0 10 0z',
  micOff: 'M3.3 2 2 3.3l6 6V11a4 4 0 0 0 5.6 3.7l1.5 1.5A6 6 0 0 1 6 11H4a8 8 0 0 0 7 7.9V21h2v-2.1c1.2-.1 2.3-.5 3.3-1.1l4.4 4.4 1.3-1.3zM16 11V6a4 4 0 0 0-7.7-1.4L16 12.300zM20 11h-2c0 .8-.2 1.600-.5 2.3l1.500 1.500c.6-1.100 1-2.400 1-3.800z',
  edit: 'M4 17.2V20h2.8L17.600 9.200l-2.800-2.800zM20.700 6.100a1 1 0 0 0 0-1.400l-1.400-1.400a1 1 0 0 0-1.400 0l-1.700 1.700 2.800 2.800z',
  trash: 'M7 21a2 2 0 0 1-2-2V7h14v12a2 2 0 0 1-2 2zM9 3h6l1 1h4v2H4V4h4z', search: 'M10 4a6 6 0 0 1 4.700 9.700l5 5-1.400 1.400-5-5A6 6 0 1 1 10 4zm0 2a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  full: 'M4 4h6v2H6v4H4zm10 0h6v6h-2V6h-4zM4 14h2v4h4v2H4zm14 0h2v6h-6v-2h4z', restart: 'M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  back: 'M15.400 5 17 6.600 11.600 12l5.400 5.400-1.600 1.600-7-7z', star: 'M12 2l3 6.500 7 .900-5.200 4.800 1.400 7-6.200-3.500L5.800 21.200l1.400-7L2 9.400l7-.900z',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 20v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1zm18 0v-1.500c0-1.500-.5-2.900-1.400-4 3 .2 5.400 2.200 5.400 4.500v1z',
  trophy: 'M7 3h10v2h4v3a5 5 0 0 1-4.600 5A5 5 0 0 1 13 15.900V19h4v2H7v-2h4v-3.100A5 5 0 0 1 7.600 13 5 5 0 0 1 3 8V5h4zm0 4H5v1a3 3 0 0 0 2 2.800zm10 0v3.800A3 3 0 0 0 19 8V7z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1 8h2v7h-2zm0-3h2v2h-2z', music: 'M9 3v10.600A4 4 0 1 0 11 17V7h8v6.600A4 4 0 1 0 21 17V3z',
  up: 'M12 6l7 7-1.400 1.400L12 8.800l-5.600 5.600L5 13z', down: 'M12 18l-7-7 1.400-1.400L12 15.200l5.600-5.600L19 11z', skip: 'M6 5l9 7-9 7zM16 5h2v14h-2z',
  sliders: 'M3 6h10v2H3zm14 0h4v2h-4zM13 4h2v6h-2zM3 16h4v2H3zm8 0h10v2H11zM7 14h2v6H7z',
  headphones: 'M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z',
  speaker: 'M4 9v6h4l5 4V5L8 9zm11.500 3a4 4 0 0 0-2-3.500v7a4 4 0 0 0 2-3.500zM13.500 3.300v2.100a7 7 0 0 1 0 13.200v2.100a9 9 0 0 0 0-17.400z',
}

export function Icon({ name, size = 22, className = '' }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden><path d={P[name]} /></svg>
}

const hash = (s: string) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }

export function useBlobUrl(blob?: Blob) {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : undefined), [blob])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  return url
}

/** Cover aus den Datei-Tags – sonst ein individueller Farbverlauf je Song */
export function Cover({ song, className = '' }: { song: Song; className?: string }) {
  const url = useBlobUrl(song.cover)
  const h = hash(song.title + song.artist)
  const a = h % 360, b = (a + 60 + (h % 80)) % 360
  return (
    <div className={`relative aspect-square overflow-hidden rounded-2xl shadow-2xl shadow-black/50 ${className}`}
      style={url ? undefined : { background: `linear-gradient(135deg, hsl(${a} 85% 55%), hsl(${b} 80% 35%))` }}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : (
        <>
          <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(circle at 30% 20%, #fff, transparent 55%)' }} />
          <div className="absolute inset-0 flex items-center justify-center text-white/90"><Icon name="music" size={0} className="h-2/5 w-2/5 drop-shadow-lg" /></div>
        </>
      )}
    </div>
  )
}

export function Stars({ value, size = 28 }: { value: number; size?: number }) {
  return (
    <div className="flex gap-1" aria-label={`${value} von 5 Sternen`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const f = Math.max(0, Math.min(1, value - i))
        return (
          <span key={i} className="relative pop" style={{ width: size, height: size, animationDelay: `${0.6 + i * 0.12}s` }}>
            <Icon name="star" size={size} className="absolute text-white/15" />
            <span className="absolute overflow-hidden" style={{ width: `${f * 100}%` }}><Icon name="star" size={size} className="text-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,.6)]" /></span>
          </span>
        )
      })}
    </div>
  )
}

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div role="dialog" aria-modal className={`rise scroll-thin max-h-[94dvh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-panel p-6 shadow-2xl sm:rounded-3xl sm:p-8 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}>
        {children}
      </div>
    </div>
  )
}

/** Fernseher-Browser (Samsung, LG, Android TV …): dort bleibt die Bedienung immer sichtbar */
export const IS_TV = /Tizen|SMART-TV|SmartTV|Web0S|WebOS|NetCast|BRAVIA|Android TV|GoogleTV|AFT[A-Z]|HbbTV|\bTV\b/i.test(navigator.userAgent)

export const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
