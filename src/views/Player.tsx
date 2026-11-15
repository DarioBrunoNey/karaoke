import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { engine } from '../audio/engine'
import { mic, type MicMode } from '../audio/mic'
import { ScoreSession, lineVerdict, type LiveState } from '../lib/scoring'
import { lineAt } from '../lib/lrc'
import { midiToName } from '../lib/pitch'
import { drawLane as draw } from './pitchLane'
import type { Melody } from '../lib/types'
import { Cover, Icon, Modal, fmtTime, useBlobUrl } from '../ui'

type Phase = 'mic' | 'loading' | 'ready' | 'error'
const LIVE_LABEL: Record<LiveState, string> = { none: '', silent: 'Sing!', hit: 'Treffer', high: 'Zu hoch', low: 'Zu tief' }
const LIVE_COLOR: Record<LiveState, string> = { none: 'text-white/40', silent: 'text-white/60', hit: 'text-emerald-300', high: 'text-sky-300', low: 'text-pink' }

export default function Player({ songId, profileId }: { songId: string; profileId: string }) {
  const song = useStore((s) => s.songs.find((x) => x.id === songId))
  const profile = useStore((s) => s.profiles.find((x) => x.id === profileId))
  const { settings, setSettings, updateSong, finish, go, say } = useStore()
  const [phase, setPhase] = useState<Phase>(settings.micAsked ? 'loading' : 'mic')
  const [progress, setProgress] = useState({ stage: 'Audio wird geladen', p: 0 })
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [lineIdx, setLineIdx] = useState(-1)
  const [vocal, setVocal] = useState(0)
  const [pitch, setPitch] = useState(0)
  const [tempo, setTempo] = useState(1)
  const [sepMode, setSepMode] = useState<Melody['source']>('center')
  const [micOn, setMicOn] = useState(false)
  const [showMic, setShowMic] = useState(false)
  const [live, setLive] = useState<{ score: number; state: LiveState; note: string; level: number }>({ score: 0, state: 'none', note: '', level: 0 })
  const [idle, setIdle] = useState(false)
  const [verdict, setVerdict] = useState<{ text: string; n: number } | null>(null)

  const session = useRef<ScoreSession | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const done = useRef(false)
  const started = useRef(false)
  const center = useRef(60)
  const liveRef = useRef<{ state: LiveState; midi: number; level: number }>({ state: 'none', midi: 0, level: 0 })
  const params = useRef({ pitch: 0, tempo: 1, micOn: false, offset: settings.micOffsetMs / 1000 })
  params.current = { pitch, tempo, micOn, offset: settings.micOffsetMs / 1000 }
  const coverUrl = useBlobUrl(song?.cover)
  const lyrics = useMemo(() => song?.lyrics ?? [], [song?.lyrics])

  const end = useCallback(async () => {
    if (done.current) return
    done.current = true
    const result = session.current?.result()
    engine.pause()
    if (!result) return go({ name: 'library' })
    await finish(songId, profileId, result, params.current.micOn)
  }, [finish, go, songId, profileId])

  const startMic = useCallback(async (mode: MicMode | 'off') => {
    if (mode === 'off') { mic.stop(); setMicOn(false); return }
    try {
      await engine.init()
      await mic.start(engine.ctx!, mode)
      setMicOn(true)
    } catch {
      setMicOn(false)
      say('Kein Mikrofonzugriff – es wird ohne Bewertung gesungen')
    }
  }, [say])

  // Laden: erst Mikrofon freigeben lassen, dann Song dekodieren, Gesang trennen, Melodie bestimmen
  useEffect(() => {
    if (phase !== 'loading' || started.current || !song) return
    started.current = true
    let cancelled = false
    ;(async () => {
      try {
        await startMic(settings.micMode)
        const { melody, mode } = await engine.load(song, (stage, p) => !cancelled && setProgress({ stage, p }))
        if (cancelled) return
        if (!song.melody || song.melody.source !== melody.source) void updateSong(song.id, { melody })
        session.current = new ScoreSession(melody, song.lyrics?.[0]?.t ?? 0)
        const m = melody.data.filter((x) => x > 0)
        if (m.length) center.current = m[m.length >> 1]
        setSepMode(mode)
        const v = mode === 'mix' ? 0 : 0
        setVocal(v)
        engine.setParams({ vocalGain: v, instGain: 1, tempo: 1, pitch: 0 })
        engine.setVolume(settings.volume)
        engine.onEnded = () => void end()
        setPhase('ready')
        await engine.play()
        setPlaying(true)
      } catch (e) {
        console.error(e)
        setError('Diese Datei konnte nicht abgespielt werden. Unterstützt werden u. a. MP3, WAV, M4A, FLAC und OGG.')
        setPhase('error')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    let lock: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => { engine.onEnded = null; engine.unload(); mic.stop(); void lock?.release() }
  }, [])

  // Ende jeder Zeile: letzter Gesangston vor der nächsten Zeile → Textfüllung läuft passend zur Melodie
  const lineEnds = useMemo(() => {
    const mel = session.current?.ref
    return lyrics.map((l, i) => {
      const next = lyrics[i + 1]?.t ?? l.t + 6
      let e = Math.min(next, l.t + 12)
      if (mel && phase === 'ready') {
        const fps = session.current!.fps
        for (let k = Math.min(mel.length - 1, Math.floor(e * fps)); k > l.t * fps + fps; k--) if (mel[k] > 0) { e = Math.min(e, (k + 1) / fps + 0.1); break }
      }
      return e
    })
  }, [lyrics, phase])

  const pages = useMemo(() => lyrics.map((l, i) => ({ t: l.t, e: lineEnds[i] })), [lyrics, lineEnds])

  // Hauptschleife: Mikrofon auswerten, Text und Tonhöhenanzeige zeichnen
  useEffect(() => {
    if (phase !== 'ready') return
    let raf = 0, lastUi = 0, idx = -2
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const t = engine.time
      const p = params.current
      const s = session.current!
      if (p.micOn && engine.playing) {
        const smp = mic.sample()
        const st = s.add(t - p.offset * p.tempo, smp.voiced ? smp.midi - p.pitch : 0)
        liveRef.current = { state: st, midi: smp.voiced ? smp.midi : 0, level: smp.level }
      }
      const i = lineAt(lyrics, t + 0.08)
      if (i !== idx) {
        // Zeile zu Ende: kurze Rückmeldung, wie gut die Stimmlage getroffen wurde
        if (idx >= 0 && p.micOn) { const r = s.hitRatio(lyrics[idx].t - 0.2, lineEnds[idx] + 0.2); if (r !== null) setVerdict({ text: lineVerdict(r), n: now }) }
        idx = i; setLineIdx(i)
      }
      if (fill.current && i >= 0) {
        const a = lyrics[i].t, b = lineEnds[i]
        fill.current.style.setProperty('--p', `${Math.max(0, Math.min(1, (t - a) / Math.max(0.3, b - a))) * 100}%`)
      }
      if (bar.current) bar.current.style.width = `${(t / Math.max(1, engine.duration)) * 100}%`
      if (clock.current) clock.current.textContent = `${fmtTime(t)} / ${fmtTime(engine.duration)}`
      draw(canvas.current, s, t, center, liveRef.current.midi ? liveRef.current.midi - p.pitch : 0, pages)
      if (now - lastUi > 250) {
        lastUi = now
        const l = liveRef.current
        setLive({ score: p.micOn ? s.result().total : 0, state: p.micOn ? l.state : 'none', note: l.midi ? midiToName(l.midi) : '', level: l.level })
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, lyrics, lineEnds, pages])

  const toggle = useCallback(() => {
    if (phase !== 'ready') return
    if (engine.playing) { engine.pause(); setPlaying(false) } else { void engine.play(); setPlaying(true) }
  }, [phase])
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}) }
  const changePitch = (d: number) => { const v = Math.max(-6, Math.min(6, pitch + d)); setPitch(v); engine.setParams({ pitch: v }) }
  const changeTempo = (d: number) => { const v = Math.round(Math.max(0.6, Math.min(1.4, tempo + d)) * 100) / 100; setTempo(v); engine.setParams({ tempo: v }) }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || showMic) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.key === 'f' || e.key === 'F') fullscreen()
      else if (e.key === 'ArrowRight') engine.seek(engine.time + 5)
      else if (e.key === 'ArrowLeft') engine.seek(engine.time - 5)
      else if (e.key === 'Escape' && !document.fullscreenElement) void end()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [toggle, end, showMic])

  // Bedienleiste blendet sich beim Singen aus (TV-Modus), jede Bewegung holt sie zurück
  useEffect(() => {
    let timer = 0
    const wake = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 4500) }
    wake()
    for (const ev of ['mousemove', 'keydown', 'touchstart', 'click']) window.addEventListener(ev, wake)
    return () => { clearTimeout(timer); for (const ev of ['mousemove', 'keydown', 'touchstart', 'click']) window.removeEventListener(ev, wake) }
  }, [])

  if (!song) return null
  const chooseMic = (mode: MicMode | 'off') => {
    setSettings({ micMode: mode, micAsked: true })
    setShowMic(false)
    if (phase === 'mic') setPhase('loading')
    else void startMic(mode)
  }
  const hideUi = idle && playing && !showMic
  const cur = lineIdx >= 0 ? lyrics[lineIdx] : null
  const firstIn = lyrics.length && lineIdx < 0 ? lyrics[0].t : 0

  return (
    <div className={`fixed inset-0 flex flex-col overflow-hidden bg-ink ${hideUi ? 'cursor-none' : ''}`}>
      {/* Hintergrund: weichgezeichnetes Cover bzw. Farbverlauf */}
      <div className="absolute inset-0 -z-0">
        {coverUrl ? <img src={coverUrl} alt="" className="h-full w-full scale-125 object-cover opacity-40 blur-3xl" /> : <div className="grad h-full w-full opacity-25 blur-3xl" />}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/40 to-ink" />
      </div>

      {/* Kopfzeile */}
      <div className={`relative z-10 flex items-center gap-4 p-4 transition-opacity duration-500 sm:p-6 ${hideUi ? 'pointer-events-none opacity-0' : ''}`}>
        <button className="btn-icon shrink-0" onClick={() => void end()} aria-label="Beenden"><Icon name="back" /></button>
        <Cover song={song} className="w-14 shrink-0 rounded-xl sm:w-20" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-black tracking-tight sm:text-3xl">{song.title}</p>
          <p className="truncate text-white/60 sm:text-lg">{song.artist}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <div className="hidden items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 font-semibold sm:flex">
            <span className="flex h-9 w-9 items-center justify-center rounded-full font-black text-black" style={{ background: profile?.color }}>{profile?.name.slice(0, 1).toUpperCase()}</span>{profile?.name}
          </div>
          {micOn && (
            <div className="text-right">
              <p data-testid="live-score" className="grad-text text-4xl font-black tabular-nums leading-none sm:text-5xl">{live.score}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-white/50">Punkte</p>
            </div>
          )}
        </div>
      </div>

      {/* Bühne: Liedtext */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center sm:px-12">
        {phase === 'loading' && (
          <div className="w-full max-w-md">
            <div className="grad mx-auto h-20 w-20 rounded-full [animation:pulse-ring_1.4s_infinite]" />
            <p className="mt-8 text-2xl font-bold">{progress.stage} …</p>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10"><div className="grad h-full transition-[width] duration-200" style={{ width: `${Math.round(progress.p * 100)}%` }} /></div>
            <p className="mt-3 text-white/50">Alles passiert auf deinem Gerät – nichts wird hochgeladen.</p>
          </div>
        )}
        {phase === 'error' && <div><p className="text-2xl font-bold">{error}</p><button className="btn mt-6" onClick={() => go({ name: 'library' })}>Zurück</button></div>}
        {phase === 'ready' && (lyrics.length === 0 ? (
          <div className="text-white/60"><p className="text-3xl font-bold text-white">Kein Liedtext hinterlegt</p><p className="mt-2 text-lg">Die Tonhöhen-Bewertung läuft trotzdem. Text später über „Song bearbeiten" ergänzen.</p></div>
        ) : (
          <div className="flex w-full max-w-[1600px] flex-col items-center gap-[2.2vh]">
            <p className="h-[1.3em] truncate text-[clamp(1rem,2.6vw,2.6rem)] font-semibold text-white/25">{lineIdx > 0 ? lyrics[lineIdx - 1].text : ''}</p>
            <p key={lineIdx} className="lyric-enter text-balance text-[clamp(2rem,6.2vw,6.5rem)] font-black leading-[1.08] tracking-tight drop-shadow-[0_4px_30px_rgba(0,0,0,.5)]">
              {cur ? <span ref={fill} className="lyric-fill">{cur.text || '♪'}</span> : <Countdown at={firstIn} />}
            </p>
            <p className="text-balance text-[clamp(1.2rem,3.4vw,3.6rem)] font-bold leading-tight text-white/55">{lyrics[lineIdx + 1]?.text ?? ''}</p>
            <p className="hidden truncate text-[clamp(1rem,2.4vw,2.4rem)] font-semibold text-white/25 sm:block">{lyrics[lineIdx + 2]?.text ?? ''}</p>
          </div>
        ))}
      </div>

      {/* Tonhöhen-Anzeige */}
      {phase === 'ready' && (
        <div className="relative z-10 mx-auto w-full max-w-[1600px] px-4 sm:px-8">
          <div className="relative h-[22vh] min-h-28 overflow-hidden rounded-3xl border border-white/10 bg-black/30">
            <canvas ref={canvas} className="h-full w-full" />
            <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-3">
              {micOn ? (
                <>
                  <span data-testid="live-state" className={`text-xl font-black sm:text-2xl ${LIVE_COLOR[live.state]}`}>{LIVE_LABEL[live.state]}</span>
                  {live.note && <span data-testid="live-note" className="rounded-full bg-white/10 px-3 py-0.5 font-mono text-sm font-bold">{live.note}</span>}
                </>
              ) : <span className="font-semibold text-white/50">Mikrofon aus – keine Bewertung</span>}
            </div>
            {verdict && <span key={verdict.n} className="pop pointer-events-none absolute right-4 top-3 rounded-full bg-white/15 px-4 py-1 text-xl font-black [animation:pop_.4s_both,fade-out_.5s_1.4s_forwards]">{verdict.text}</span>}
            {micOn && <div className="absolute bottom-3 left-4 h-1.5 w-24 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300 transition-[width] duration-100" style={{ width: `${live.level * 100}%` }} /></div>}
          </div>
        </div>
      )}

      {/* Bedienleiste */}
      <div className={`relative z-10 p-4 transition-opacity duration-500 sm:p-6 ${hideUi ? 'pointer-events-none opacity-0' : ''}`}>
        <div className="group relative h-5 cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); engine.seek(((e.clientX - r.left) / r.width) * engine.duration) }}>
          <div className="absolute inset-x-0 top-1.5 h-2 overflow-hidden rounded-full bg-white/15"><div ref={bar} className="grad h-full rounded-full" style={{ width: 0 }} /></div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-3">
          <div className="flex items-center gap-2">
            <button className="btn-icon" onClick={() => engine.seek(0)} aria-label="Von vorn"><Icon name="restart" /></button>
            <button className="btn-primary h-16 w-16 p-0" onClick={toggle} disabled={phase !== 'ready'} aria-label={playing ? 'Pause' : 'Wiedergabe'}><Icon name={playing ? 'pause' : 'play'} size={32} /></button>
            <span ref={clock} className="ml-1 w-24 font-mono text-sm tabular-nums text-white/60">0:00 / {fmtTime(song.duration)}</span>
          </div>

          <label className="flex min-w-44 flex-1 flex-col sm:max-w-64" title={sepMode === 'mix' ? 'Mono-Aufnahme: Gesang lässt sich im Browser nicht trennen' : ''}>
            <span className="label">Originalgesang {sepMode === 'mix' ? '(nicht trennbar)' : `${Math.round(vocal * 100)} %`}</span>
            <input type="range" min={0} max={1} step={0.05} value={vocal} disabled={sepMode === 'mix'} aria-label="Lautstärke Originalgesang"
              onChange={(e) => { const v = +e.target.value; setVocal(v); engine.setParams({ vocalGain: v }) }} />
          </label>
          <label className="flex min-w-36 flex-1 flex-col sm:max-w-52">
            <span className="label">Lautstärke</span>
            <input type="range" min={0} max={1} step={0.02} value={settings.volume} aria-label="Lautstärke" onChange={(e) => { const v = +e.target.value; setSettings({ volume: v }); engine.setVolume(v) }} />
          </label>

          <Stepper label="Tonhöhe" value={pitch === 0 ? '±0' : (pitch > 0 ? '+' : '') + pitch} onMinus={() => changePitch(-1)} onPlus={() => changePitch(1)} />
          <Stepper label="Tempo" value={`${Math.round(tempo * 100)} %`} onMinus={() => changeTempo(-0.05)} onPlus={() => changeTempo(0.05)} />

          <div className="ml-auto flex items-center gap-2">
            <button className={`btn ${micOn ? '' : 'text-white/50'}`} onClick={() => setShowMic(true)}>
              <Icon name={!micOn ? 'micOff' : settings.micMode === 'speaker' ? 'speaker' : 'headphones'} size={20} />
              <span className="hidden md:inline">{!micOn ? 'Mikrofon aus' : settings.micMode === 'speaker' ? 'Lautsprecher' : 'Kopfhörer'}</span>
            </button>
            <button className="btn-icon" onClick={fullscreen} aria-label="Vollbild"><Icon name="full" /></button>
          </div>
        </div>
      </div>

      {(phase === 'mic' || showMic) && <MicDialog current={micOn ? settings.micMode : 'off'} first={phase === 'mic'} onChoose={chooseMic} onClose={phase === 'mic' ? undefined : () => setShowMic(false)} />}
    </div>
  )
}

function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus(): void; onPlus(): void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center rounded-full bg-white/10">
        <button className="h-11 w-11 cursor-pointer rounded-full text-2xl font-bold hover:bg-white/15" onClick={onMinus} aria-label={`${label} verringern`}>−</button>
        <span className="w-14 text-center font-bold tabular-nums">{value}</span>
        <button className="h-11 w-11 cursor-pointer rounded-full text-2xl font-bold hover:bg-white/15" onClick={onPlus} aria-label={`${label} erhöhen`}>+</button>
      </div>
    </div>
  )
}

function Countdown({ at }: { at: number }) {
  const [left, setLeft] = useState(99)
  useEffect(() => {
    const id = setInterval(() => setLeft(at - engine.time), 100)
    return () => clearInterval(id)
  }, [at])
  if (left > 5) return <span className="text-white/30">♪</span>
  return <span className="grad-text">{'● '.repeat(Math.max(1, Math.ceil(left))).trim()}</span>
}

export function MicDialog({ current, first, onChoose, onClose }: { current: MicMode | 'off'; first: boolean; onChoose(m: MicMode | 'off'): void; onClose?: () => void }) {
  const Opt = ({ mode, icon, title, text, tag }: { mode: MicMode | 'off'; icon: string; title: string; text: string; tag?: string }) => (
    <button data-testid={`mic-${mode}`} onClick={() => onChoose(mode)} className={`flex w-full cursor-pointer items-center gap-4 rounded-2xl border p-4 text-left transition hover:bg-white/10 ${current === mode && !first ? 'border-white/50 bg-white/10' : 'border-white/10'}`}>
      <span className="grad flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl"><Icon name={icon} size={28} /></span>
      <span><span className="flex items-center gap-2 text-xl font-bold">{title}{tag && <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-xs text-emerald-300">{tag}</span>}</span><span className="text-white/60">{text}</span></span>
    </button>
  )
  return (
    <Modal onClose={onClose}>
      <h2 className="text-3xl font-black tracking-tight">Wie hörst du die Musik?</h2>
      <p className="mt-2 text-white/65">Für die Bewertung hört das eingebaute Mikrofon deines Geräts mit. Gleich fragt der Browser nach der Erlaubnis. Dein Gesang wird <b className="text-white">nur live auf diesem Gerät analysiert – nichts wird aufgenommen, gespeichert oder übertragen.</b></p>
      <div className="mt-5 space-y-3">
        <Opt mode="headphones" icon="headphones" title="Kopfhörer" tag="genaueste Bewertung" text="Musik auf den Ohren, das Mikrofon hört nur dich." />
        <Opt mode="speaker" icon="speaker" title="Lautsprecher / Fernseher" text="Die Musik wird per Echo-Unterdrückung aus dem Mikrofonsignal gefiltert. Gerät nah bei dir, Lautstärke moderat." />
        <Opt mode="off" icon="micOff" title="Ohne Mikrofon" text="Nur mitsingen – ohne Punkte." />
      </div>
    </Modal>
  )
}
