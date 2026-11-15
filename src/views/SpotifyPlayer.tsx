import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, Stars, fmtTime } from '../ui'
import { lineAt } from '../lib/lrc'
import { midiToName } from '../lib/pitch'
import { ScoreSession, type LiveState } from '../lib/scoring'
import { freeScore } from '../lib/freeScore'
import { parseUltraStar, syllableProgress, type UsSong } from '../lib/ultrastar'
import type { LyricLine, ScoreResult, SpTrack } from '../lib/types'
import { engine } from '../audio/engine'
import { mic, type MicMode } from '../audio/mic'
import { browserTransport, lyricsFor, remoteTransport, type Transport } from '../spotify/api'
import { drawLane } from './pitchLane'
import { MicDialog } from './Player'

type Phase = 'mic' | 'loading' | 'ready' | 'ended' | 'error'
const FPS = 50
const LIVE_LABEL: Record<LiveState, string> = { none: '', silent: 'Sing!', hit: 'Treffer', high: 'Zu hoch', low: 'Zu tief' }
const LIVE_COLOR: Record<LiveState, string> = { none: 'text-white/40', silent: 'text-white/60', hit: 'text-emerald-300', high: 'text-sky-300', low: 'text-pink' }
const usKey = (id: string) => 'encore-us-' + id

/**
 * Spotify-Modus: Spotify spielt die Originalaufnahme, die App zeigt den Text synchron und bewertet die Stimme.
 * Mit Melodie-Datei (UltraStar): echter Vergleich mit der Originalmelodie. Ohne: Tonsicherheit und Timing.
 */
export default function SpotifyPlayer({ track, profileId }: { track: SpTrack; profileId: string }) {
  const profile = useStore((s) => s.profiles.find((p) => p.id === profileId))
  const { settings, setSettings, go, queue, songs, profiles, playNext, playSpotify, setLibraryTab, addScore, say } = useStore()
  const [phase, setPhase] = useState<Phase>(settings.micAsked ? 'loading' : 'mic')
  const [error, setError] = useState('')
  const [lrc, setLrc] = useState<LyricLine[]>([])
  const [plain, setPlain] = useState('')
  const [diff, setDiff] = useState(0)
  const [lyricsLoaded, setLyricsLoaded] = useState(false)
  const [us, setUs] = useState<UsSong | null>(() => {
    try { const raw = localStorage.getItem(usKey(track.id)); return raw ? parseUltraStar(raw) : null } catch { return null }
  })
  const [lineIdx, setLineIdx] = useState(-1)
  const [paused, setPaused] = useState(false)
  const [offset, setOffset] = useState(() => +(localStorage.getItem('encore-off-' + track.id) ?? localStorage.getItem('encore-off-default') ?? 0))
  const [idle, setIdle] = useState(false)
  const [device, setDevice] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [showMic, setShowMic] = useState(false)
  const [showMelody, setShowMelody] = useState(false)
  const [live, setLive] = useState<{ score: number; state: LiveState; note: string; level: number }>({ score: 0, state: 'none', note: '', level: 0 })
  const [result, setResult] = useState<{ r: ScoreResult; rank?: number; withRef: boolean } | null>(null)

  const tr = useRef<Transport | null>(null)
  const session = useRef<ScoreSession | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const center = useRef(60)
  const liveRef = useRef<{ state: LiveState; midi: number; level: number }>({ state: 'none', midi: 0, level: 0 })
  const p = useRef({ offset, micOn, micOffset: settings.micOffsetMs / 1000 })
  p.current = { offset, micOn, micOffset: settings.micOffsetMs / 1000 }

  const lines: LyricLine[] = useMemo(() => (us ? us.lines : lrc), [us, lrc])
  const hasRef = !!us

  // Neue Wertung beginnen, sobald feststeht, womit verglichen wird
  useEffect(() => {
    const len = Math.ceil((track.durationMs / 1000) * FPS)
    const data = new Float32Array(len)
    if (us) data.set(us.melody.subarray(0, len))
    session.current = new ScoreSession({ fps: FPS, data, source: 'stems' })
    const voiced = data.filter((x) => x > 0)
    if (voiced.length) center.current = voiced[voiced.length >> 1]
  }, [us, track.durationMs])

  const startMic = useCallback(async (mode: MicMode | 'off') => {
    if (mode === 'off') { mic.stop(); setMicOn(false); return }
    try { await engine.init(); await mic.start(engine.ctx!, mode); setMicOn(true) }
    catch { setMicOn(false); say('Kein Mikrofonzugriff – es wird ohne Bewertung gesungen') }
  }, [say])

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

  const begun = useRef(false)
  useEffect(() => {
    if (phase !== 'loading' || begun.current) return
    begun.current = true
    void startMic(settings.micMode)
    void start('browser')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    lyricsFor(track).then((l) => { setLrc(l.lines); setPlain(l.plain); setDiff(l.diff) }).finally(() => setLyricsLoaded(true))
    let lock: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => { tr.current?.destroy(); tr.current = null; mic.stop(); void lock?.release() }
  }, [track])

  const finish = useCallback(async () => {
    const t = tr.current
    t?.destroy(); tr.current = null
    const s = session.current
    if (p.current.micOn && s) {
      const r = hasRef ? s.result() : freeScore(s.user, FPS, lines)
      let rank: number | undefined
      if (r.valid && profile) {
        rank = await addScore({ songId: 'sp:' + track.id, songTitle: track.name, artist: track.artists, profileId, profileName: profile.name, total: r.total, accuracy: r.accuracy, stars: r.stars, award: r.award.title })
      }
      setResult({ r, rank, withRef: hasRef })
    }
    setPhase('ended')
  }, [hasRef, lines, profile, addScore, track, profileId])
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (phase !== 'ready') return
    let raf = 0, idx = -2, lastUi = 0, started = false, prev = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const t = tr.current, s = session.current
      if (!t || !s) return
      const pos = t.time(), dur = t.duration()
      const lt = pos - p.current.offset
      if (p.current.micOn && !t.paused()) {
        const smp = mic.sample()
        const st = s.add(lt - p.current.micOffset, smp.voiced ? smp.midi : 0)
        liveRef.current = { state: st, midi: smp.voiced ? smp.midi : 0, level: smp.level }
      }
      // ohne Silbenzeiten: Zeile kurz vor dem Einsatz zeigen; mit Melodie-Datei exakt
      const i = lineAt(lines, lt + (hasRef ? 0.15 : 0.3))
      if (i !== idx) { idx = i; setLineIdx(i) }
      if (hasRef && fill.current && i >= 0 && us) fill.current.style.setProperty('--p', `${syllableProgress(us.lines[i], lt) * 100}%`)
      if (bar.current) bar.current.style.width = `${(pos / Math.max(1, dur)) * 100}%`
      if (clock.current) clock.current.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`
      drawLane(canvas.current, s, lt, center, liveRef.current.midi)
      if (pos > 2) started = true
      // Songende: anhalten, damit Spotify nicht von selbst mit anderen Titeln weiterspielt
      if (started && (pos >= dur - 0.6 || (t.paused() && pos < 0.5 && prev > dur - 5))) { cancelAnimationFrame(raf); void finishRef.current(); return }
      prev = pos
      if (now - lastUi > 300) {
        lastUi = now
        setPaused(t.paused()); if (t.kind === 'remote') setDevice(t.deviceName)
        const l = liveRef.current
        if (p.current.micOn) setLive({ score: (hasRef ? s.result() : freeScore(s.user, FPS, lines)).total, state: l.state, note: l.midi ? midiToName(l.midi) : '', level: l.level })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, lines, hasRef, us])

  const toggle = useCallback(() => { void tr.current?.toggle().catch(() => {}) }, [])
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}) }
  const leave = useCallback(() => { setLibraryTab('spotify'); go({ name: 'library' }) }, [go, setLibraryTab])
  const shift = (d: number) => { const v = Math.round((offset + d) * 100) / 100; setOffset(v); localStorage.setItem('encore-off-' + track.id, String(v)); localStorage.setItem('encore-off-default', String(v)) }
  const chooseMic = (mode: MicMode | 'off') => {
    setSettings({ micMode: mode, micAsked: true }); setShowMic(false)
    if (phase === 'mic') setPhase('loading'); else void startMic(mode)
  }
  const applyMelody = (text: string | null) => {
    if (text === null) { localStorage.removeItem(usKey(track.id)); setUs(null); setShowMelody(false); return }
    const song = parseUltraStar(text) // wirft bei ungültiger Datei – der Dialog zeigt die Meldung
    try { localStorage.setItem(usKey(track.id), text) } catch { /* Speicher voll: gilt dann nur für diesen Durchlauf */ }
    setUs(song); setShowMelody(false)
    void tr.current?.seek(0)
    say(`Melodie geladen: ${song.notes} Noten – Song startet neu`)
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || showMic || showMelody) return
      const t = tr.current
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.key === 'f' || e.key === 'F') fullscreen()
      else if (e.key === 'ArrowRight' && t) void t.seek(t.time() + 5)
      else if (e.key === 'ArrowLeft' && t) void t.seek(Math.max(0, t.time() - 5))
      else if (e.key === 'Escape' && !document.fullscreenElement) leave()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [toggle, leave, showMic, showMelody])

  useEffect(() => {
    let timer = 0
    const wake = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 4500) }
    wake()
    const evs = ['mousemove', 'keydown', 'touchstart', 'click']
    for (const ev of evs) window.addEventListener(ev, wake)
    return () => { clearTimeout(timer); for (const ev of evs) window.removeEventListener(ev, wake) }
  }, [])

  const hideUi = idle && phase === 'ready' && !paused && !showMic && !showMelody
  const cur = lineIdx >= 0 ? lines[lineIdx] : null
  const next = queue[0]
  const nextTitle = next && (next.spotify?.name ?? songs.find((s) => s.id === next.songId)?.title)
  const nextSinger = next && profiles.find((x) => x.id === next.profileId)?.name
  const liveLabel = hasRef ? LIVE_LABEL[live.state] : live.note ? 'Stimme erkannt' : 'Sing!'
  const liveColor = hasRef ? LIVE_COLOR[live.state] : live.note ? 'text-emerald-300' : 'text-white/60'

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
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 font-semibold sm:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-full font-black text-black" style={{ background: profile?.color }}>{profile?.name.slice(0, 1).toUpperCase()}</span>{profile?.name}
          </div>
          {micOn && phase === 'ready' && (
            <div className="text-right">
              <p data-testid="live-score" className="grad-text text-4xl font-black tabular-nums leading-none sm:text-5xl">{live.score}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-white/50">Punkte</p>
            </div>
          )}
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
          <div className="pop w-full max-w-2xl">
            {result ? (
              <>
                <p className="text-5xl">{result.r.award.emoji}</p>
                <h1 className="grad-text mt-1 text-5xl font-black tracking-tight sm:text-6xl">{result.r.award.title}</h1>
                <p className="mt-1 text-lg text-white/60">{profile?.name} · {track.name}</p>
                <p className="mt-4 text-8xl font-black tabular-nums tracking-tighter" data-testid="total">{result.r.total}<span className="ml-2 text-2xl font-semibold tracking-normal text-white/40">/ 100</span></p>
                <div className="mt-2 flex justify-center"><Stars value={result.r.stars} size={36} /></div>
                <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-left sm:grid-cols-4">
                  {([['pitch', result.withRef ? 'Tonhöhe' : 'Tonsicherheit'], ['rhythm', 'Rhythmus'], ['timing', 'Einsatz'], ['continuity', 'Kontinuität']] as const).map(([k, label]) => (
                    <div key={k}>
                      <div className="flex items-baseline justify-between"><span className="font-bold">{label}</span><span data-testid={`part-${k}`} className="font-black tabular-nums">{result.r.parts[k]}</span></div>
                      <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-white/10"><div className="grad h-full rounded-full" style={{ width: `${result.r.parts[k]}%` }} /></div>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-sm text-white/50">
                  {result.withRef ? `${result.r.accuracy} % der gesungenen Töne getroffen` : `${result.r.accuracy} % deiner Töne passen in eine Tonart. Ohne Melodie-Datei misst die App Tonsicherheit und Timing – nicht, ob es die richtige Melodie war.`}
                  {result.rank ? ` · Platz ${result.rank} bei diesem Song` : ''}{!result.r.valid ? ' · Nicht zu Ende gesungen – zählt nicht für die Bestenliste.' : ''}
                </p>
              </>
            ) : (
              <><p className="text-6xl">🎤</p><h1 className="grad-text mt-2 text-5xl font-black tracking-tight sm:text-6xl">Applaus!</h1><p className="mt-2 text-xl text-white/60">{profile?.name} · {track.name}</p></>
            )}
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
              {cur ? (hasRef ? <span ref={fill} className="lyric-fill">{cur.text}</span> : <span className="text-white">{cur.text}</span>) : <span className="text-white/30">♪</span>}
            </p>
            <p className="text-balance text-[clamp(1.2rem,3.4vw,3.6rem)] font-bold leading-tight text-white/55">{lines[lineIdx + 1]?.text ?? ''}</p>
            <p className="hidden truncate text-[clamp(1rem,2.4vw,2.4rem)] font-semibold text-white/25 sm:block">{lines[lineIdx + 2]?.text ?? ''}</p>
          </div>
        ) : !lyricsLoaded ? <p className="text-2xl font-bold text-white/60">Liedtext wird gesucht …</p> : plain ? (
          <div className="scroll-thin max-h-full w-full max-w-4xl overflow-y-auto whitespace-pre-line py-6 text-[clamp(1.1rem,2.4vw,2.2rem)] font-semibold leading-relaxed text-white/85">
            <p className="mb-4 text-base font-normal text-white/45">Für diesen Titel gibt es nur unsynchronisierten Text.</p>{plain}
          </div>
        ) : <div className="text-white/60"><p className="text-3xl font-bold text-white">Kein Liedtext gefunden</p><p className="mt-2 text-lg">Über „Melodie laden“ lässt sich eine Karaoke-Datei mit Text und Melodie ergänzen.</p></div>)}
      </div>

      {/* Stimme: Tonhöhen-Bahn */}
      {phase === 'ready' && micOn && (
        <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 sm:px-8">
          <div className="relative h-[16vh] min-h-24 overflow-hidden rounded-3xl border border-white/10 bg-black/30">
            <canvas ref={canvas} className="h-full w-full" />
            <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-3">
              <span data-testid="live-state" className={`text-xl font-black sm:text-2xl ${liveColor}`}>{liveLabel}</span>
              {live.note && <span data-testid="live-note" className="rounded-full bg-white/10 px-3 py-0.5 font-mono text-sm font-bold">{live.note}</span>}
            </div>
            {!hasRef && <button className="absolute right-3 top-3 cursor-pointer rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/70 hover:bg-white/20" onClick={() => setShowMelody(true)}>Ohne Originalmelodie · Melodie laden</button>}
            <div className="absolute bottom-3 left-4 h-1.5 w-24 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300 transition-[width] duration-100" style={{ width: `${live.level * 100}%` }} /></div>
          </div>
        </div>
      )}

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
            <div>
              <span className="label">Text-Versatz</span>
              <div className="flex items-center rounded-full bg-white/10">
                <button className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => shift(-0.25)} aria-label="Text früher">früher</button>
                <span className="w-16 text-center font-bold tabular-nums">{offset > 0 ? '+' : ''}{offset.toFixed(2).replace('.', ',')} s</span>
                <button className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => shift(0.25)} aria-label="Text später">später</button>
              </div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!hasRef && lines.length > 0 && diff >= 2 && <span className="hidden rounded-full bg-yellow-300/15 px-3 py-1.5 text-sm font-semibold text-yellow-200 xl:inline" title="Die gefundene Textfassung ist anders lang als die Spotify-Aufnahme">Text evtl. andere Fassung</span>}
              <span className="hidden rounded-full bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-300 xl:inline">Spotify · {device}</span>
              <button className="btn" onClick={() => setShowMelody(true)}><Icon name="music" size={20} /><span className="hidden md:inline">{hasRef ? 'Melodie ✓' : 'Melodie laden'}</span></button>
              <button className={`btn ${micOn ? '' : 'text-white/50'}`} onClick={() => setShowMic(true)}>
                <Icon name={!micOn ? 'micOff' : settings.micMode === 'speaker' ? 'speaker' : 'headphones'} size={20} />
                <span className="hidden md:inline">{!micOn ? 'Mikrofon aus' : settings.micMode === 'speaker' ? 'Lautsprecher' : 'Kopfhörer'}</span>
              </button>
              {tr.current?.kind === 'browser' && <button className="btn-icon hidden lg:inline-flex" onClick={() => void start('remote')} title="Auf einem anderen Spotify-Gerät abspielen" aria-label="Anderes Gerät"><Icon name="speaker" /></button>}
              <button className="btn-icon" onClick={fullscreen} aria-label="Vollbild"><Icon name="full" /></button>
            </div>
          </div>
        </div>
      )}

      {(phase === 'mic' || showMic) && <MicDialog current={micOn ? settings.micMode : 'off'} first={phase === 'mic'} onChoose={chooseMic} onClose={phase === 'mic' ? undefined : () => setShowMic(false)} />}
      {showMelody && <MelodyDialog track={track} loaded={us} onApply={applyMelody} onClose={() => setShowMelody(false)} />}
    </div>
  )
}

function MelodyDialog({ track, loaded, onApply, onClose }: { track: SpTrack; loaded: UsSong | null; onApply(text: string | null): void; onClose(): void }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const apply = (t: string) => { try { onApply(t) } catch (e) { setErr((e as Error).message) } }
  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start gap-4">
        <h2 className="flex-1 text-3xl font-black tracking-tight">Melodie für „{track.name}“</h2>
        <button className="btn-icon" onClick={onClose} aria-label="Schließen"><Icon name="close" /></button>
      </div>
      <div className="mt-3 space-y-3 text-white/65">
        <p>Spotify gibt die Melodie eines Songs nicht heraus. Mit einer <b className="text-white">Karaoke-Datei im UltraStar-Format (.txt)</b> kennt die App jeden Ton: Dann gibt es die Balken der Originalmelodie, „zu hoch / zu tief“, silbengenauen Text und echte Trefferpunkte.</p>
        <p>Solche Dateien werden von Fans erstellt und in UltraStar-Song-Datenbanken geteilt (Suchbegriff: „UltraStar {track.name}“). Datei herunterladen und hier laden – nur die .txt, Audio oder Video werden nicht gebraucht. Bitte nur für den privaten Gebrauch.</p>
        {loaded && <p className="rounded-2xl bg-emerald-400/15 p-3 text-emerald-200">Geladen: {loaded.title || track.name} – {loaded.notes} Noten, {loaded.lines.length} Zeilen. Passt der Einsatz nicht, mit „Text-Versatz“ verschieben.</p>}
        {err && <p className="rounded-2xl bg-red-500/15 p-3 text-red-200">{err}</p>}
      </div>
      <textarea className="field scroll-thin mt-4 h-40 font-mono text-sm" placeholder={'#TITLE:…\n#BPM:…\n#GAP:…\n: 0 4 2 Text'} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="btn-primary cursor-pointer">Datei wählen (.txt)<input type="file" accept=".txt,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) apply(await readText(f)) }} /></label>
        <button className="btn" disabled={!text.trim()} onClick={() => apply(text)}>Eingefügten Text übernehmen</button>
        {loaded && <button className="btn" onClick={() => onApply(null)}>Melodie entfernen</button>}
      </div>
    </Modal>
  )
}

/** UltraStar-Dateien sind oft nicht UTF-8 – bei Ersatzzeichen als Windows-1252 neu lesen */
async function readText(f: File): Promise<string> {
  const buf = await f.arrayBuffer()
  const utf = new TextDecoder('utf-8').decode(buf)
  return utf.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf
}
