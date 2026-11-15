import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon, fmtTime } from '../ui'
import { lineAt } from '../lib/lrc'
import type { LyricLine, SpTrack } from '../lib/types'
import { browserTransport, lyricsFor, remoteTransport, type Transport } from '../spotify/api'

type Phase = 'loading' | 'ready' | 'ended' | 'error'

/** Mitsing-Modus: Spotify spielt die Originalaufnahme, die App zeigt den Text synchron zur Wiedergabeposition. */
export default function SpotifyPlayer({ track, profileId }: { track: SpTrack; profileId: string }) {
  const profile = useStore((s) => s.profiles.find((p) => p.id === profileId))
  const { settings, setSettings, go, queue, songs, profiles, playNext, playSpotify, setLibraryTab } = useStore()
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [lines, setLines] = useState<LyricLine[]>([])
  const [plain, setPlain] = useState('')
  const [diff, setDiff] = useState(0)
  const [lyricsLoaded, setLyricsLoaded] = useState(false)
  const [lineIdx, setLineIdx] = useState(-1)
  const [paused, setPaused] = useState(false)
  const [offset, setOffset] = useState(() => +(localStorage.getItem('encore-off-' + track.id) ?? localStorage.getItem('encore-off-default') ?? 0))
  const [idle, setIdle] = useState(false)
  const [device, setDevice] = useState('')
  const tr = useRef<Transport | null>(null)
  const bar = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const off = useRef(offset)
  off.current = offset

  const start = useCallback(async (mode: 'browser' | 'remote') => {
    setPhase('loading'); setError('')
    tr.current?.destroy(); tr.current = null
    try {
      const t = mode === 'browser' ? await browserTransport(track, settings.volume) : await remoteTransport(track)
      tr.current = t
      setDevice(t.deviceName)
      setPhase('ready')
    } catch (e) {
      setError((e as Error).message || 'Wiedergabe nicht möglich')
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track])

  useEffect(() => {
    void start('browser')
    lyricsFor(track).then((l) => { setLines(l.lines); setPlain(l.plain); setDiff(l.diff) }).finally(() => setLyricsLoaded(true))
    let lock: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => { tr.current?.destroy(); tr.current = null; void lock?.release() }
  }, [start, track])

  useEffect(() => {
    if (phase !== 'ready') return
    let raf = 0, idx = -2, lastUi = 0, begun = false, prev = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const t = tr.current
      if (!t) return
      const pos = t.time(), dur = t.duration()
      const lt = pos - off.current
      // Zeile eine Vierteltakt-Länge vor dem Einsatz zeigen, damit man rechtzeitig lesen kann
      const i = lineAt(lines, lt + 0.3)
      if (i !== idx) { idx = i; setLineIdx(i) }
      if (bar.current) bar.current.style.width = `${(pos / Math.max(1, dur)) * 100}%`
      if (clock.current) clock.current.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`
      if (pos > 2) begun = true
      // Songende: anhalten, damit Spotify nicht von selbst mit anderen Titeln weiterspielt
      if (begun && (pos >= dur - 0.6 || (t.paused() && pos < 0.5 && prev > dur - 5))) { t.destroy(); tr.current = null; setPhase('ended'); return }
      prev = pos
      if (now - lastUi > 300) { lastUi = now; setPaused(t.paused()); if (t.kind === 'remote') setDevice(t.deviceName) }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, lines])

  const toggle = useCallback(() => { void tr.current?.toggle().catch(() => {}) }, [])
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}) }
  const leave = useCallback(() => { setLibraryTab('spotify'); go({ name: 'library' }) }, [go, setLibraryTab])
  const shift = (d: number) => { const v = Math.round((offset + d) * 100) / 100; setOffset(v); localStorage.setItem('encore-off-' + track.id, String(v)); localStorage.setItem('encore-off-default', String(v)) }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      const t = tr.current
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.key === 'f' || e.key === 'F') fullscreen()
      else if (e.key === 'ArrowRight' && t) void t.seek(t.time() + 5)
      else if (e.key === 'ArrowLeft' && t) void t.seek(Math.max(0, t.time() - 5))
      else if (e.key === 'Escape' && !document.fullscreenElement) leave()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [toggle, leave])

  useEffect(() => {
    let timer = 0
    const wake = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 4500) }
    wake()
    const evs = ['mousemove', 'keydown', 'touchstart', 'click']
    for (const ev of evs) window.addEventListener(ev, wake)
    return () => { clearTimeout(timer); for (const ev of evs) window.removeEventListener(ev, wake) }
  }, [])

  const hideUi = idle && phase === 'ready' && !paused
  const cur = lineIdx >= 0 ? lines[lineIdx] : null
  const next = queue[0]
  const nextTitle = next && (next.spotify?.name ?? songs.find((s) => s.id === next.songId)?.title)
  const nextSinger = next && profiles.find((p) => p.id === next.profileId)?.name

  return (
    <div className={`fixed inset-0 flex flex-col overflow-hidden bg-ink ${hideUi ? 'cursor-none' : ''}`}>
      <div className="absolute inset-0">
        {track.cover && <img src={track.cover} alt="" className="h-full w-full scale-125 object-cover opacity-45 blur-3xl" />}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/40 to-ink" />
      </div>

      <div className={`relative z-10 flex items-center gap-4 p-4 transition-opacity duration-500 sm:p-6 ${hideUi ? 'pointer-events-none opacity-0' : ''}`}>
        <button className="btn-icon shrink-0" onClick={leave} aria-label="Beenden"><Icon name="back" /></button>
        {track.cover && <img src={track.cover} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover shadow-2xl sm:h-20 sm:w-20" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-black tracking-tight sm:text-3xl">{track.name}</p>
          <p className="truncate text-white/60 sm:text-lg">{track.artists}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 font-semibold sm:flex">
          <span className="flex h-9 w-9 items-center justify-center rounded-full font-black text-black" style={{ background: profile?.color }}>{profile?.name.slice(0, 1).toUpperCase()}</span>{profile?.name}
        </div>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center sm:px-12">
        {phase === 'loading' && <div><div className="grad mx-auto h-20 w-20 rounded-full [animation:pulse-ring_1.4s_infinite]" /><p className="mt-8 text-2xl font-bold">Spotify wird gestartet …</p></div>}
        {phase === 'error' && (
          <div className="glass max-w-xl p-8">
            <p className="text-2xl font-bold">Wiedergabe in diesem Browser nicht möglich</p>
            <p className="mt-2 text-white/65">{error}</p>
            <p className="mt-2 text-white/65">Alternative: Spotify auf dem Fernseher, Handy oder einer Box öffnen – die App steuert dann dieses Gerät und zeigt hier den Text.</p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button className="btn-primary" onClick={() => void start('remote')}>Auf anderem Spotify-Gerät abspielen</button>
              <button className="btn" onClick={() => void start('browser')}>Erneut versuchen</button>
              <button className="btn" onClick={leave}>Zurück</button>
            </div>
          </div>
        )}
        {phase === 'ended' && (
          <div className="pop">
            <p className="text-6xl">🎤</p>
            <h1 className="grad-text mt-2 text-5xl font-black tracking-tight sm:text-6xl">Applaus!</h1>
            <p className="mt-2 text-xl text-white/60">{profile?.name} · {track.name}</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {nextTitle && <button className="btn-primary px-7 py-4 text-lg" onClick={() => playNext()}><Icon name="skip" />Weiter: {nextSinger} – {nextTitle}</button>}
              <button className={`${nextTitle ? 'btn' : 'btn-primary'} px-7 py-4 text-lg`} onClick={() => playSpotify(track, profileId)}><Icon name="restart" />Nochmal</button>
              <button className="btn px-7 py-4 text-lg" onClick={leave}><Icon name="music" />Songauswahl</button>
            </div>
          </div>
        )}
        {phase === 'ready' && (lines.length ? (
          <div className="flex w-full max-w-[1600px] flex-col items-center gap-[2.2vh]">
            <p className="h-[1.3em] truncate text-[clamp(1rem,2.6vw,2.6rem)] font-semibold text-white/25">{lineIdx > 0 ? lines[lineIdx - 1].text : ''}</p>
            <p key={lineIdx} className="lyric-enter text-balance text-[clamp(2rem,6.2vw,6.5rem)] font-black leading-[1.08] tracking-tight drop-shadow-[0_4px_30px_rgba(0,0,0,.5)]">
              {cur ? <span className="text-white">{cur.text}</span> : <span className="text-white/30">♪</span>}
            </p>
            <p className="text-balance text-[clamp(1.2rem,3.4vw,3.6rem)] font-bold leading-tight text-white/55">{lines[lineIdx + 1]?.text ?? ''}</p>
            <p className="hidden truncate text-[clamp(1rem,2.4vw,2.4rem)] font-semibold text-white/25 sm:block">{lines[lineIdx + 2]?.text ?? ''}</p>
          </div>
        ) : !lyricsLoaded ? <p className="text-2xl font-bold text-white/60">Liedtext wird gesucht …</p> : plain ? (
          <div className="scroll-thin max-h-full w-full max-w-4xl overflow-y-auto whitespace-pre-line py-6 text-[clamp(1.1rem,2.4vw,2.2rem)] font-semibold leading-relaxed text-white/85">
            <p className="mb-4 text-base font-normal text-white/45">Für diesen Titel gibt es nur unsynchronisierten Text.</p>{plain}
          </div>
        ) : <div className="text-white/60"><p className="text-3xl font-bold text-white">Kein Liedtext gefunden</p><p className="mt-2 text-lg">Für diesen Titel liegt in der offenen Textdatenbank nichts vor.</p></div>)}
      </div>

      {phase === 'ready' && (
        <div className={`relative z-10 p-4 transition-opacity duration-500 sm:p-6 ${hideUi ? 'pointer-events-none opacity-0' : ''}`}>
          <div className="relative h-5 cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const t = tr.current; if (t) void t.seek(((e.clientX - r.left) / r.width) * t.duration()) }}>
            <div className="absolute inset-x-0 top-1.5 h-2 overflow-hidden rounded-full bg-white/15"><div ref={bar} className="grad h-full rounded-full" style={{ width: 0 }} /></div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="flex items-center gap-2">
              <button className="btn-icon" onClick={() => void tr.current?.seek(0)} aria-label="Von vorn"><Icon name="restart" /></button>
              <button className="btn-primary h-16 w-16 p-0" onClick={toggle} aria-label={paused ? 'Wiedergabe' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} size={32} /></button>
              <span ref={clock} className="ml-1 w-24 font-mono text-sm tabular-nums text-white/60">0:00 / {fmtTime(track.durationMs / 1000)}</span>
            </div>
            {tr.current?.kind === 'browser' && (
              <label className="flex min-w-36 flex-1 flex-col sm:max-w-52">
                <span className="label">Lautstärke</span>
                <input type="range" min={0} max={1} step={0.02} value={settings.volume} aria-label="Lautstärke" onChange={(e) => { const v = +e.target.value; setSettings({ volume: v }); tr.current?.setVolume(v) }} />
              </label>
            )}
            {lines.length > 0 && (
              <div>
                <span className="label">Text-Versatz</span>
                <div className="flex items-center rounded-full bg-white/10">
                  <button className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => shift(-0.25)} aria-label="Text früher">früher</button>
                  <span className="w-16 text-center font-bold tabular-nums">{offset > 0 ? '+' : ''}{offset.toFixed(2).replace('.', ',')} s</span>
                  <button className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => shift(0.25)} aria-label="Text später">später</button>
                </div>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              {lines.length > 0 && diff >= 2 && <span className="hidden rounded-full bg-yellow-300/15 px-3 py-1.5 text-sm font-semibold text-yellow-200 md:inline" title="Die gefundene Textfassung ist anders lang als die Spotify-Aufnahme">Text evtl. andere Fassung</span>}
              <span className="hidden rounded-full bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-300 md:inline">Spotify · {device}</span>
              {tr.current?.kind === 'browser' && <button className="btn hidden lg:inline-flex" onClick={() => void start('remote')} title="Auf einem anderen Spotify-Gerät abspielen"><Icon name="speaker" size={20} />Anderes Gerät</button>}
              <button className="btn-icon" onClick={fullscreen} aria-label="Vollbild"><Icon name="full" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
