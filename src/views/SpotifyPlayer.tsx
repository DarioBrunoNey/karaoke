import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon, IS_TV, Modal, Stars, fmtTime } from '../ui'
import { lineAt } from '../lib/lrc'
import { paintCountdown, secondsToEntry } from '../lib/countdown'
import { midiToName } from '../lib/pitch'
import { ScoreSession, lineVerdict, type LiveState } from '../lib/scoring'
import { estimateWords } from '../lib/words'
import { findSections, type Section } from '../lib/sections'
import { freeScore } from '../lib/freeScore'
import { parseUltraStar, syllableProgress, type UsLine, type UsSong } from '../lib/ultrastar'
import type { LyricLine, ScoreResult, SpTrack } from '../lib/types'
import { engine } from '../audio/engine'
import { mic, type MicMode } from '../audio/mic'
import { browserTransport, lyricsFor, remoteTransport, resetSpotifyPlayer, type Transport } from '../spotify/api'
import { diag } from '../lib/diag'
import { findMelody } from '../spotify/melodyDb'
import { announceTurn, hasPhone, phoneSample, resetPhoneGates, sendToPhone } from '../remote/host'
import PhonePanel from './PhonePanel'
import { drawLane } from './pitchLane'
import { MicDialog } from './Player'

type Phase = 'mic' | 'loading' | 'ready' | 'ended' | 'error'
const FPS = 50
const LIVE_LABEL: Record<LiveState, string> = { none: '', silent: 'Sing!', hit: 'Treffer', high: 'Zu hoch', low: 'Zu tief' }
const LIVE_COLOR: Record<LiveState, string> = { none: 'text-white/40', silent: 'text-white/60', hit: 'text-emerald-300', high: 'text-sky-300', low: 'text-pink' }
const LEAD = 3 // Sekunden Vorlauf vor einem Abschnitt
/** Ein Abschnitt, den ein bestimmter Sänger singt */
interface Round { pids: string[]; s: number; e: number; label: string }
type Live = { score: number; state: LiveState; note: string; level: number }
const usKey = (id: string) => 'encore-us4-' + id

/**
 * Spotify-Modus: Spotify spielt die Originalaufnahme, die App zeigt den Text synchron und bewertet die Stimme.
 * Mit Melodie-Datei (UltraStar): echter Vergleich mit der Originalmelodie. Ohne: Tonsicherheit und Timing.
 */
export default function SpotifyPlayer({ track, profileId }: { track: SpTrack; profileId: string }) {
  const profile = useStore((s) => s.profiles.find((p) => p.id === profileId))
  const { settings, setSettings, go, queue, songs, profiles, playNext, playSpotify, setLibraryTab, addScore, say, phones } = useStore()
  // Sind Handys verbunden, wählt die App den Ablauf selbst: ein Handy = dessen Besitzer singt,
  // ab zwei Handys singen alle gleichzeitig. Das eingebaute Mikrofon wird dann nicht gebraucht.
  const [auto] = useState(() => phones.map((ph) => ph.pid).slice(0, 4))
  const [phase, setPhase] = useState<Phase>(settings.micAsked || auto.length ? 'loading' : 'mic')
  const [error, setError] = useState('')
  const [lrc, setLrc] = useState<LyricLine[]>([])
  const [plain, setPlain] = useState('')
  const [diff, setDiff] = useState(0)
  /** Länge (s) einer anderen Aufnahme, für die es synchronen Text gäbe */
  const [otherVersion, setOtherVersion] = useState(0)
  const [lyricsLoaded, setLyricsLoaded] = useState(false)
  const [us, setUs] = useState<UsSong | null>(() => {
    try { const raw = localStorage.getItem(usKey(track.id)); return raw && raw !== '-' ? parseUltraStar(raw) : null } catch { return null }
  })
  /** Automatische Notensuche: läuft, gefunden, nichts gefunden */
  const [notes, setNotes] = useState<'search' | 'found' | 'none'>(() => (localStorage.getItem(usKey(track.id)) ? 'found' : 'search'))
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
  const fill = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const cd = useRef<HTMLDivElement>(null)
  const clock = useRef<HTMLSpanElement>(null)
  const center = useRef(60)
  const liveRef = useRef<{ state: LiveState; midi: number; level: number }>({ state: 'none', midi: 0, level: 0 })
  const p = useRef({ offset, micOn, micOffset: settings.micOffsetMs / 1000 })
  p.current = { offset, micOn, micOffset: settings.micOffsetMs / 1000 }

  // Mit Melodie-Datei sind die Silbenzeiten exakt; sonst werden die Wortzeiten aus den Zeilenzeiten geschätzt
  const lines: UsLine[] = useMemo(() => (us ? us.lines : estimateWords(lrc)), [us, lrc])
  const pages = useMemo(() => lines.map((l) => ({ t: l.t, e: l.syl[l.syl.length - 1]?.e ?? l.t + 3 })), [lines])
  const pageEnds = useMemo(() => pages.map((x) => x.e), [pages])
  const [verdict, setVerdict] = useState<{ text: string; n: number } | null>(null)
  const hasRef = !!us

  // Mehrspieler / einzelne Abschnitte: Ablaufplan und je Sänger eine eigene Wertung
  const [plan, setPlan] = useState<Round[] | null>(() => (auto.length > 1 ? [{ pids: auto, s: 0, e: track.durationMs / 1000 + 5, label: '' }] : null))
  const planRef = useRef<Round[] | null>(plan)
  const ri = useRef(0)
  const [turn, setTurn] = useState<{ pids: string[]; label: string; next: string }>({ pids: auto.length ? auto : [profileId], label: '', next: '' })
  /** wer gerade singt – mehrere bei gleichzeitigem Singen mit Handy-Mikrofonen */
  const turnPids = useRef<string[]>(auto.length ? auto : [profileId])
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  const centers = useRef<{ current: number }[]>([])
  const lives = useRef(new Map<string, { state: LiveState; midi: number; level: number }>())
  /**
   * Selbst erkannter Zeitversatz der Stimme in Sekunden, getrennt für Handy-Mikrofon und eingebautes Mikrofon.
   * Startwert ist der zuletzt gelernte – der Aufbau (Fernseher, Funk) ändert sich von Song zu Song selten.
   */
  const autoLag = useRef({ phone: +(localStorage.getItem('encore-lag-phone') || 0), local: +(localStorage.getItem('encore-lag-local') || 0) })
  const lagCheck = useRef(0)
  const [lagShown, setLagShown] = useState(0)
  const [liveAll, setLiveAll] = useState<Record<string, Live>>({})
  const sessions = useRef(new Map<string, ScoreSession>())
  const [showMode, setShowMode] = useState(false)
  const [tries, setTries] = useState(0)
  const startRun = useRef(0)
  /** true, sobald im Modus-Dialog von Hand gewählt wurde */
  const manual = useRef(false)
  const [showSettings, setShowSettings] = useState(false)
  /** Hinweis: das Mikrofon hört die Musik mit */
  const [bleed, setBleed] = useState(false)
  const warned = useRef(false)
  const switched = useRef(false)
  const [multi, setMulti] = useState<{ pid: string; r: ScoreResult }[] | null>(null)
  const sections = useMemo(() => findSections(lines.map((l, i) => ({ t: l.t, e: pages[i].e, text: l.text }))), [lines, pages])

  const melodyData = useMemo(() => {
    const len = Math.ceil((track.durationMs / 1000) * FPS)
    const data = new Float32Array(len)
    if (us) data.set(us.melody.subarray(0, len))
    return data
  }, [us, track.durationMs])
  const sessFor = useCallback((pid: string) => {
    let s = sessions.current.get(pid)
    if (!s) { s = new ScoreSession({ fps: FPS, data: melodyData, source: 'stems' }, 0, settings.difficulty); sessions.current.set(pid, s) }
    return s
  }, [melodyData, settings.difficulty])
  // Neue Wertung beginnen, sobald feststeht, womit verglichen wird
  useEffect(() => {
    sessions.current = new Map()
    session.current = sessFor(turnPids.current[0])
    const voiced = melodyData.filter((x) => x > 0)
    if (voiced.length) center.current = voiced[voiced.length >> 1]
    centers.current = []
  }, [melodyData, sessFor])

  const startMic = useCallback(async (mode: MicMode | 'off') => {
    if (mode === 'off') { mic.stop(); setMicOn(false); return }
    try { await engine.init(); await mic.start(engine.ctx!, mode); setMicOn(true) }
    catch { setMicOn(false); say('Kein Mikrofonzugriff – es wird ohne Bewertung gesungen') }
  }, [say])

  const start = useCallback(async (mode: 'browser' | 'remote') => {
    setPhase('loading'); setError('')
    tr.current?.destroy(); tr.current = null
    const run = ++startRun.current
    try {
      setTries(0)
      const onTry = (n: number) => { if (run === startRun.current) setTries(n) }
      const open = () => (mode === 'browser' ? browserTransport(track, settings.volume, onTry) : remoteTransport(track))
      // Scheitert der Start, einmal von selbst mit einem ganz frischen Player neu ansetzen – erst danach eine Meldung zeigen
      const t = await open().catch((e) => {
        const status = (e as { status?: number }).status
        if (mode !== 'browser' || status === 401 || status === 403 || run !== startRun.current) throw e
        diag('Zweiter Anlauf mit frischem Player')
        resetSpotifyPlayer()
        return open()
      })
      // inzwischen wurde ein anderer Weg gewählt (z. B. „anderes Gerät") – diesen Start verwerfen
      if (run !== startRun.current) { t.destroy(); return }
      tr.current = t
      setDevice(t.deviceName)
      setPhase('ready')
    } catch (e) {
      if (run !== startRun.current) return
      diag('Fehlermeldung gezeigt: ' + ((e as Error).message || 'unbekannt'))
      setError((e as Error).message || 'Wiedergabe nicht möglich')
      setPhase('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track])

  const begun = useRef(false)
  useEffect(() => {
    if (phase !== 'loading' || begun.current) return
    begun.current = true
    if (!auto.length) void startMic(settings.micMode)
    void start('browser')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  useEffect(() => {
    let gone = false
    lyricsFor(track)
      .then(async (l) => {
        setLrc(l.lines); setPlain(l.plain); setDiff(l.diff); setOtherVersion(l.otherVersion ?? 0); setLyricsLoaded(true)
        if (localStorage.getItem(usKey(track.id))) return // schon geladen – oder vom Nutzer bewusst entfernt
        const m = await findMelody(track, l.lines).catch(() => null)
        if (gone) return
        if (!m) { setNotes('none'); return }
        try { localStorage.setItem(usKey(track.id), m.text) } catch { /* nur für diesen Durchlauf */ }
        setUs(parseUltraStar(m.text)); setNotes('found')
        say(m.aligned ? 'Noten gefunden und an die Spotify-Aufnahme angepasst' : 'Noten gefunden – Einsatz bitte mit „Text-Versatz“ prüfen')
      })
      .catch(() => setNotes('none'))
      .finally(() => setLyricsLoaded(true))
    let lock: WakeLockSentinel | undefined
    navigator.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {})
    return () => { gone = true; tr.current?.destroy(); tr.current = null; mic.stop(); void lock?.release() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track])

  const finish = useCallback(async () => {
    const t = tr.current
    t?.destroy(); tr.current = null
    const s = session.current
    const score = (x: ScoreSession) => (hasRef ? x.result() : freeScore(x.user, FPS, lines))
    const pl = planRef.current
    const pids = pl ? [...new Set(pl.flatMap((r) => r.pids))] : []
    const voice = p.current.micOn || turnPids.current.some(hasPhone)
    // jedes Handy bekommt die Auswertung seines Besitzers
    const tell = (pid: string, r: ScoreResult, rank: number, of: number) => sendToPhone(pid, {
      k: 'r', song: track.name, total: r.total, stars: r.stars, award: r.award.title, emoji: r.award.emoji,
      pitch: r.parts.pitch, pitchLabel: hasRef ? 'Tonhöhe' : 'Tonsicherheit', timing: r.parts.timing, rank, of,
    })
    if (voice && pids.length > 1) {
      const table = pids.map((pid) => ({ pid, r: score(sessFor(pid)) })).sort((a, b) => b.r.total - a.r.total)
      table.forEach((row, i) => tell(row.pid, row.r, i + 1, table.length))
      setMulti(table)
    } else if (voice && s) {
      const r = score(s)
      const who = profiles.find((x) => x.id === turnPids.current[0])
      let rank: number | undefined
      if (r.valid && who && !pl) {
        rank = await addScore({ songId: 'sp:' + track.id, songTitle: track.name, artist: track.artists, profileId: who.id, profileName: who.name, total: r.total, accuracy: r.accuracy, stars: r.stars, award: r.award.title })
      }
      setResult({ r, rank, withRef: hasRef })
      tell(turnPids.current[0], r, 1, 1)
    }
    setPhase('ended')
  }, [hasRef, lines, profiles, addScore, track, sessFor])
  // den Handys mitteilen, welcher Song läuft und wer gerade singt
  useEffect(() => { announceTurn(phase === 'ready' ? turn.pids : [], phase === 'ended' ? '' : track.name) }, [turn.pids, phase, track.name])
  useEffect(() => { resetPhoneGates(); return () => announceTurn([], '') }, [])
  useEffect(() => {
    if (manual.current || (phase !== 'ready' && phase !== 'mic' && phase !== 'loading')) return
    const pids = phones.map((ph) => ph.pid).slice(0, 4)
    const cur = turnPids.current
    if (!pids.length || (pids.length === cur.length && pids.every((x) => cur.includes(x)))) return
    const rounds: Round[] | null = pids.length > 1 ? [{ pids, s: 0, e: track.durationMs / 1000 + 5, label: '' }] : null
    planRef.current = rounds; setPlan(rounds); ri.current = 0
    turnPids.current = pids
    session.current = sessFor(pids[0])
    lives.current.clear(); centers.current = []
    setTurn({ pids, label: '', next: '' })
    setShowMic(false)
    if (phase === 'mic') { setSettings({ micAsked: true }); setPhase('loading') }
    const names = pids.map((x) => profiles.find((pr) => pr.id === x)?.name).filter(Boolean).join(' und ')
    say(pids.length > 1 ? `${names} singen gemeinsam` : `${names} singt mit dem Handy`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phones, phase])
  const finishRef = useRef(finish)
  finishRef.current = finish

  useEffect(() => {
    if (phase !== 'ready') return
    let raf = 0, idx = -2, lastUi = 0, started = false, prev = 0, tickN = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      const t = tr.current
      if (!t || !session.current) return
      const pos = t.time(), dur = t.duration()
      const lt = pos - p.current.offset
      // Ablaufplan: Abschnitt zu Ende → nächster Sänger bzw. Schluss
      const pl = planRef.current
      let active = true
      if (pl) {
        let r = pl[ri.current]
        // läuft der nächste Abschnitt direkt weiter (Mikro weitergeben), kurz vor dessen Beginn umschalten
        const nx = pl[ri.current + 1]
        const until = nx && nx.s >= r.e ? Math.min(r.e + 0.6, Math.max(r.e, nx.s - 0.3)) : r.e + 0.6
        if (lt > until && pos > 0.5) {
          ri.current++
          if (ri.current >= pl.length) { cancelAnimationFrame(raf); void finishRef.current(); return }
          r = pl[ri.current]
          turnPids.current = r.pids
          session.current = sessFor(r.pids[0])
          lives.current.clear()
          // nur springen, wenn der Abschnitt weit voraus liegt oder schon begonnen hat (Duell: zurück an den Anfang)
          if (lt < r.s - LEAD - 1.5 || lt > r.s + 0.3) void t.seek(Math.max(0, r.s - LEAD + p.current.offset))
          setTurn({ pids: r.pids, label: r.label, next: '' })
          return
        }
        active = lt >= r.s - 0.5
      }
      const s = session.current
      // Stimme je Sänger: sein Handy-Mikrofon, sonst das eingebaute Mikrofon dieses Geräts
      const singers = turnPids.current
      let local: ReturnType<typeof mic.sample> | null = null
      // Soll gerade niemand singen (Intro, Zwischenspiel)? Dann misst das Mikrofon, wie laut die Musik bei ihm ankommt.
      const fi = Math.max(0, Math.round(lt * FPS))
      const silent = hasRef ? !s.refNear(fi, 18) : !pages.some((pg) => lt > pg.t - 0.5 && lt < pg.e + 0.6)
      // Das Mikrofon hört die Musik mit: zuerst auf Echo-Unterdrückung umschalten (falls noch „Kopfhörer" eingestellt
      // ist, aber über Lautsprecher gehört wird). Erst wenn auch das nicht reicht, den Hinweis zeigen.
      if (p.current.micOn && mic.bleed > 0.02) {
        if (mic.mode === 'headphones' && !switched.current) {
          switched.current = true
          setSettings({ micMode: 'speaker' })
          void startMic('speaker')
          say('Musik im Mikrofon erkannt – Echo-Unterdrückung eingeschaltet')
        } else if (!warned.current && mic.mode === 'speaker' && mic.bleed > 0.04 && pos > 20) { warned.current = true; setBleed(true) }
      }
      singers.forEach((pid, k) => {
        const viaPhone = phoneSample(pid, silent)
        const smp = viaPhone ?? (p.current.micOn ? (local ??= mic.sample(silent)) : null)
        const sess = sessFor(pid)
        if (smp && !t.paused() && active) {
          // Handy: Funkstrecke braucht etwas länger als das eingebaute Mikrofon
          const st = sess.add(lt - p.current.micOffset - (viaPhone ? 0.08 + autoLag.current.phone : autoLag.current.local), smp.voiced ? smp.midi : 0)
          lives.current.set(pid, { state: st, midi: smp.voiced ? smp.midi : 0, level: smp.level })
        }
        const c = (centers.current[k] ??= { current: center.current })
        drawLane(canvases.current[k] ?? null, sess, lt, c, lives.current.get(pid)?.midi ?? 0, pages)
      })
      liveRef.current = lives.current.get(singers[0]) ?? { state: 'none', midi: 0, level: 0 }
      const i = lineAt(lines, lt + 0.15)
      if (i !== idx) {
        if (idx >= 0 && hasRef && singers.length === 1 && lives.current.size) { const r = s.hitRatio(pages[idx].t - 0.2, pages[idx].e + 0.2); if (r !== null) setVerdict({ text: lineVerdict(r), n: now }) }
        idx = i; setLineIdx(i)
      }
      if (fill.current && i >= 0) fill.current.style.setProperty('--p', `${syllableProgress(lines[i], lt) * 100}%`)
      paintCountdown(cd.current, t.paused() ? 0 : secondsToEntry(pages, pageEnds, i, lt))
      if (bar.current) bar.current.style.width = `${(pos / Math.max(1, dur)) * 100}%`
      if (clock.current) clock.current.textContent = `${fmtTime(pos)} / ${fmtTime(dur)}`
      if (pos > 2) started = true
      // Songende: anhalten, damit Spotify nicht von selbst mit anderen Titeln weiterspielt
      if (started && (pos >= dur - 0.6 || (t.paused() && pos < 0.5 && prev > dur - 5))) { cancelAnimationFrame(raf); void finishRef.current(); return }
      prev = pos
      if (now - lastUi > 300) {
        lastUi = now
        setPaused(t.paused()); if (t.kind === 'remote') setDevice(t.deviceName)
        const l = liveRef.current
        if (pl) {
          const r = pl[ri.current], nx = pl[ri.current + 1]
          const soon = nx && nx.pids[0] !== r.pids[0] && lt > r.e - 3 ? nx.pids[0] : ''
          setTurn((cur) => (cur.next === soon ? cur : { ...cur, next: soon }))
        }
        // Alle 5 s prüfen, ob die Stimme insgesamt versetzt ankommt (z. B. Ton über Funk am Fernseher) – und ausgleichen
        if (hasRef && now - lagCheck.current > 3000 && pos > 12) {
          lagCheck.current = now
          for (const pid of singers) {
            const ss = sessFor(pid), kind = hasPhone(pid) ? 'phone' : 'local'
            const lag = ss.estimateLag()
            if (lag) {
              for (const other of singers) if ((hasPhone(other) ? 'phone' : 'local') === kind) sessFor(other).shift(lag)
              autoLag.current[kind] = Math.max(-0.2, Math.min(1.5, autoLag.current[kind] + lag / FPS))
              localStorage.setItem('encore-lag-' + kind, autoLag.current[kind].toFixed(2))
              setLagShown(autoLag.current[kind])
              break
            }
          }
        }
        const all: Record<string, Live> = {}
        for (const pid of singers) {
          const lv = lives.current.get(pid), ss = sessFor(pid)
          all[pid] = { score: (hasRef ? ss.result() : freeScore(ss.user, FPS, lines)).total, state: lv?.state ?? 'none', note: lv?.midi ? midiToName(lv.midi) : '', level: lv?.level ?? 0 }
        }
        setLiveAll(all)
        // jedem Handy seine eigene laufende Punktzahl schicken (etwa einmal pro Sekunde)
        if (++tickN % 3 === 0) for (const pid of singers) if (hasPhone(pid)) sendToPhone(pid, { k: 's', score: all[pid].score, label: hasRef ? LIVE_LABEL[all[pid].state] : '' })
        if (all[singers[0]]) setLive(all[singers[0]])
        void l
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [phase, lines, hasRef, pages, pageEnds, sessFor])

  const toggle = useCallback(() => { void tr.current?.toggle().catch(() => {}) }, [])
  const fullscreen = () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.().catch(() => {}) }
  const leave = useCallback(() => { setLibraryTab('spotify'); go({ name: 'library' }) }, [go, setLibraryTab])
  const shift = (d: number) => { const v = Math.round((offset + d) * 100) / 100; setOffset(v); localStorage.setItem('encore-off-' + track.id, String(v)); localStorage.setItem('encore-off-default', String(v)) }
  const chooseMic = (mode: MicMode | 'off') => {
    setSettings({ micMode: mode, micAsked: true }); setShowMic(false)
    if (phase === 'mic') setPhase('loading'); else void startMic(mode)
  }
  /** Startet einen Ablauf: wer singt, welcher Teil, gleichzeitig / abwechselnd / als Duell */
  const startMode = (pids: string[], part: Section | null, style: 'simul' | 'pass' | 'duel') => {
    manual.current = true // ab jetzt gilt die Wahl aus dem Modus-Dialog, nicht mehr die Automatik
    const t = tr.current
    if (!t || !pids.length) return
    let rounds: Round[] | null = null
    const whole = { s: sections[0]?.s ?? 0, e: sections[sections.length - 1]?.e ?? track.durationMs / 1000 - 1 }
    if (pids.length === 1) rounds = part ? [{ pids, s: part.s, e: part.e, label: part.label }] : null
    else if (style === 'simul') rounds = [{ pids, s: part?.s ?? 0, e: part?.e ?? track.durationMs / 1000 + 5, label: part?.label ?? '' }]
    else if (style === 'duel') rounds = pids.map((pid) => ({ pids: [pid], s: (part ?? whole).s, e: (part ?? whole).e, label: part?.label ?? 'Ganzer Song' }))
    else if (part) rounds = pages.slice(part.from, part.to + 1).map((pg, k) => ({ pids: [pids[k % pids.length]], s: pg.t, e: pg.e, label: part.label }))
    else rounds = sections.map((sec, k) => ({ pids: [pids[k % pids.length]], s: sec.s, e: sec.e, label: sec.label }))
    if (rounds && !rounds.length) rounds = null
    planRef.current = rounds; setPlan(rounds); ri.current = 0
    sessions.current = new Map(); lives.current.clear(); centers.current = []
    turnPids.current = rounds ? rounds[0].pids : [pids[0]]
    session.current = sessFor(turnPids.current[0])
    setTurn({ pids: turnPids.current, label: rounds?.[0].label ?? '', next: '' })
    setResult(null); setMulti(null); setShowMode(false); setLiveAll({})
    void t.seek(Math.max(0, (rounds ? rounds[0].s - LEAD : 0) + offset)).then(() => { if (t.paused()) void t.toggle() })
  }
  /** Stimm-Verzögerung von Hand nachstellen (Schritte von 40 ms); wirkt sofort, auch auf das schon Gesungene */
  const nudgeLag = (frames: number) => {
    const kind = turnPids.current.some(hasPhone) ? 'phone' : 'local'
    for (const pid of turnPids.current) if ((hasPhone(pid) ? 'phone' : 'local') === kind) sessFor(pid).shift(frames)
    autoLag.current[kind] = Math.max(-0.2, Math.min(1.5, autoLag.current[kind] + frames / FPS))
    localStorage.setItem('encore-lag-' + kind, autoLag.current[kind].toFixed(2))
    lagCheck.current = performance.now() + 20000 // der Automatik eine Weile nicht dazwischenfunken lassen
    setLagShown(autoLag.current[kind] || 0.0001)
  }
  const applyMelody = (text: string | null) => {
    if (text === null) { localStorage.setItem(usKey(track.id), '-'); setUs(null); setNotes('none'); setShowMelody(false); return }
    const song = parseUltraStar(text) // wirft bei ungültiger Datei – der Dialog zeigt die Meldung
    try { localStorage.setItem(usKey(track.id), text) } catch { /* Speicher voll: gilt dann nur für diesen Durchlauf */ }
    setUs(song); setShowMelody(false)
    void tr.current?.seek(0)
    say(`Melodie geladen: ${song.notes} Noten – Song startet neu`)
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || showMic || showMelody || showMode || showSettings) return
      const t = tr.current
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.key === 'f' || e.key === 'F') fullscreen()
      else if (e.key === 'ArrowRight' && t) void t.seek(t.time() + 5)
      else if (e.key === 'ArrowLeft' && t) void t.seek(Math.max(0, t.time() - 5))
      else if (e.key === 'Escape' && !document.fullscreenElement) leave()
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [toggle, leave, showMic, showMelody, showMode, showSettings])

  useEffect(() => {
    let timer = 0
    const wake = () => { setIdle(false); clearTimeout(timer); timer = window.setTimeout(() => setIdle(true), 4500) }
    wake()
    const evs = ['mousemove', 'keydown', 'touchstart', 'click']
    for (const ev of evs) window.addEventListener(ev, wake)
    return () => { clearTimeout(timer); for (const ev of evs) window.removeEventListener(ev, wake) }
  }, [])

  const hideUi = !IS_TV && idle && phase === 'ready' && !paused && !showMic && !showMelody && !showMode && !showSettings
  const singer = profiles.find((x) => x.id === turn.pids[0]) ?? profile
  const voiceOn = micOn || turn.pids.some((pid) => phones.some((ph) => ph.pid === pid))
  const upNext = turn.next ? profiles.find((x) => x.id === turn.next) : undefined
  const many = !!plan && new Set(plan.flatMap((r) => r.pids)).size > 1
  const together = turn.pids.length > 1
  const cur = lineIdx >= 0 ? lines[lineIdx] : null
  const next = queue[0]
  const nextTitle = next && (next.spotify?.name ?? songs.find((s) => s.id === next.songId)?.title)
  const nextSinger = next && profiles.find((x) => x.id === next.profileId)?.name

  return (
    <div className={`fixed inset-0 flex flex-col overflow-hidden bg-ink ${hideUi ? 'cursor-none' : ''}`}>
      <div className="absolute inset-0">
        {track.cover && <img src={track.cover} alt="" className="h-full w-full scale-125 object-cover opacity-45 blur-3xl" />}
        <div className="absolute inset-0 bg-gradient-to-b from-ink/60 via-ink/40 to-ink" />
      </div>

      <div className={`relative z-10 flex items-center gap-4 p-4 transition-opacity duration-500 sm:p-6 ${hideUi ? 'pointer-events-none opacity-0' : ''}`}>
        <button className="btn-icon shrink-0" onClick={leave} aria-label="Beenden"><Icon name="back" /></button>
        {track.cover && <img src={track.cover} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:h-20 sm:w-20" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-black tracking-tight sm:text-3xl">{track.name}</p>
          <p className="truncate text-white/60 sm:text-lg">{track.artists}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <button className="hidden cursor-pointer items-center gap-2 rounded-full bg-white/10 py-1.5 pl-1.5 pr-4 font-semibold hover:bg-white/20 sm:flex" onClick={() => setShowMode(true)} title="Sänger und Spielmodus wählen">
            <span className="flex h-9 w-9 items-center justify-center rounded-full font-black text-black" style={{ background: singer?.color }}>{singer?.name.slice(0, 1).toUpperCase()}</span>{together ? `${turn.pids.length} Sänger` : singer?.name}
            {turn.pids.some((pid) => phones.some((ph) => ph.pid === pid)) && <Icon name="mic" size={16} className="text-emerald-300" />}
          </button>
          {voiceOn && phase === 'ready' && !together && (
            <div className="text-right">
              <p data-testid="live-score" className="grad-text text-4xl font-black tabular-nums leading-none sm:text-5xl">{live.score}</p>
              <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-white/50">Punkte</p>
            </div>
          )}
        </div>
      </div>

      {phase === 'ready' && plan && (
        <div className="pointer-events-none relative z-10 flex flex-wrap items-center justify-center gap-3 px-4">
          <span data-testid="turn" className="rounded-full px-5 py-2 text-xl font-black text-black shadow-xl sm:text-2xl" style={{ background: singer?.color }}>{together ? 'Alle singen gemeinsam' : many ? `Am Mikro: ${singer?.name}` : turn.label || 'Abschnitt'}</span>
          {many && turn.label && <span className="rounded-full bg-white/10 px-4 py-2 font-semibold">{turn.label}</span>}
          {upNext && <span key={upNext.id} className="pop rounded-full border-2 px-4 py-1.5 text-lg font-bold" style={{ borderColor: upNext.color, color: upNext.color }}>Gleich dran: {upNext.name}</span>}
        </div>
      )}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 text-center sm:px-12">
        {/* Countdown vor dem Einsatz nach einer Pause */}
        <div ref={cd} data-testid="countdown" className="pointer-events-none absolute left-1/2 top-[6%] flex -translate-x-1/2 flex-col items-center opacity-0 transition-opacity duration-200">
          <span className="grad-text text-[clamp(3rem,9vw,8rem)] font-black leading-none tabular-nums">3</span>
          <div className="mt-2 h-1.5 w-40 overflow-hidden rounded-full bg-white/15"><div className="grad h-full rounded-full" /></div>
        </div>
        {phase === 'loading' && (
          <div>
            <div className="grad mx-auto h-20 w-20 rounded-full [animation:pulse-ring_1.4s_infinite]" />
            <p className="mt-8 text-2xl font-bold">Spotify wird gestartet …</p>
            {/* dauert es länger, zeigt die App, dass sie dran ist – und bietet Auswege an */}
            {tries > 2 && (
              <div className="rise mt-5">
                <p className="text-white/55">Spotify braucht gerade etwas länger ({tries}. Versuch).</p>
                <div className="mt-4 flex flex-wrap justify-center gap-3">
                  <button className="btn" onClick={() => void start('remote')}>Auf anderem Spotify-Gerät abspielen</button>
                  <button className="btn" onClick={leave}>Abbrechen</button>
                </div>
              </div>
            )}
          </div>
        )}
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
            {multi ? (
              <>
                <p className="text-5xl">🏆</p>
                <h1 className="grad-text mt-1 text-5xl font-black tracking-tight sm:text-6xl">{profiles.find((x) => x.id === multi[0].pid)?.name} gewinnt!</h1>
                <p className="mt-1 text-lg text-white/60">{track.name}{plan?.[0].label && plan.every((r) => r.label === plan[0].label) ? ` · ${plan[0].label}` : ''}</p>
                <ol className="mt-6 space-y-2 text-left">
                  {multi.map((m, i) => {
                    const who = profiles.find((x) => x.id === m.pid)
                    return (
                      <li key={m.pid} data-testid={`rank-${i + 1}`} className={`flex items-center gap-4 rounded-2xl border p-3 ${i === 0 ? 'border-white/40 bg-white/10' : 'border-white/10'}`}>
                        <span className="w-8 text-center text-2xl font-black text-white/50">{['🥇', '🥈', '🥉'][i] ?? i + 1}</span>
                        <span className="flex h-11 w-11 items-center justify-center rounded-full text-lg font-black text-black" style={{ background: who?.color }}>{who?.name.slice(0, 1).toUpperCase()}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate text-xl font-bold">{who?.name}</span><span className="text-sm text-white/50">{m.r.award.emoji} {m.r.award.title} · {hasRef ? 'Tonhöhe' : 'Tonsicherheit'} {m.r.parts.pitch} · Einsatz {m.r.parts.timing}</span></span>
                        <span className="grad-text text-4xl font-black tabular-nums">{m.r.total}</span>
                      </li>
                    )
                  })}
                </ol>
              </>
            ) : result ? (
              <>
                <p className="text-5xl">{result.r.award.emoji}</p>
                <h1 className="grad-text mt-1 text-5xl font-black tracking-tight sm:text-6xl">{result.r.award.title}</h1>
                <p className="mt-1 text-lg text-white/60">{singer?.name} · {track.name}{plan ? ` · ${plan[0].label}` : ''}</p>
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
                  {result.rank ? ` · Platz ${result.rank} bei diesem Song` : ''}{plan ? ' · Einzelner Abschnitt – zählt nicht für die Bestenliste.' : !result.r.valid ? ' · Nicht zu Ende gesungen – zählt nicht für die Bestenliste.' : ''}
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
              {cur ? <span ref={fill} className="lyric-fill">{cur.text}</span> : <span className="text-white/30">♪</span>}
            </p>
            <p className="text-balance text-[clamp(1.2rem,3.4vw,3.6rem)] font-bold leading-tight text-white/55">{lines[lineIdx + 1]?.text ?? ''}</p>
            <p className="hidden truncate text-[clamp(1rem,2.4vw,2.4rem)] font-semibold text-white/25 sm:block">{lines[lineIdx + 2]?.text ?? ''}</p>
          </div>
        ) : !lyricsLoaded ? <p className="text-2xl font-bold text-white/60">Liedtext wird gesucht …</p> : plain ? (
          <div className="scroll-thin max-h-full w-full max-w-4xl overflow-y-auto whitespace-pre-line py-6 text-[clamp(1.1rem,2.4vw,2.2rem)] font-semibold leading-relaxed text-white/85">
            <p className="mb-4 rounded-2xl bg-white/10 p-3 text-base font-normal text-white/70">{otherVersion ? `Für diese Aufnahme gibt es keinen passend getakteten Text – nur für eine andere Fassung des Songs (Länge ${fmtTime(otherVersion)}). Such bei Spotify die Fassung mit dieser Länge, dann läuft der Text mit.` : 'Für diesen Titel gibt es nur Text ohne Zeitangaben.'}</p>{plain}
          </div>
        ) : <div className="text-white/60"><p className="text-3xl font-bold text-white">Kein Liedtext gefunden</p><p className="mt-2 text-lg">Über „Melodie laden“ lässt sich eine Karaoke-Datei mit Text und Melodie ergänzen.</p></div>)}
      </div>

      {/* Stimme: je Sänger eine Notenbahn */}
      {/* Die Notenbahn bleibt auch ohne Mikrofon sichtbar – dann mit einem Knopf zum Einschalten */}
      {phase === 'ready' && (voiceOn || hasRef) && (
        <div className="relative z-10 mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 sm:px-8">
          {turn.pids.map((pid, k) => {
            const who = profiles.find((x) => x.id === pid)
            const lv = together ? liveAll[pid] : live
            const label = !lv ? '' : hasRef ? LIVE_LABEL[lv.state] : lv.note ? 'Stimme erkannt' : 'Sing!'
            const color = !lv ? '' : hasRef ? LIVE_COLOR[lv.state] : lv.note ? 'text-emerald-300' : 'text-white/60'
            return (
              <div key={pid} data-testid={`lane-${who?.name}`} className="relative overflow-hidden rounded-3xl border bg-black/30" style={{ height: `${Math.max(11, 22 / Math.min(2, turn.pids.length) + (turn.pids.length > 2 ? -3 : 0))}vh`, minHeight: together ? 76 : 112, borderColor: together ? who?.color : 'rgba(255,255,255,.1)' }}>
                <canvas ref={(el) => { canvases.current[k] = el }} className="h-full w-full" />
                {!voiceOn && <button data-testid="mic-on" className="absolute left-3 top-2.5 z-10 flex cursor-pointer items-center gap-2 rounded-full bg-yellow-300 px-4 py-1.5 text-sm font-bold text-black shadow-lg hover:brightness-105" onClick={() => setShowMic(true)}><Icon name="micOff" size={16} />Mikrofon wählen: Handy oder dieses Gerät</button>}
                <div className={`pointer-events-none absolute left-4 top-2.5 flex items-center gap-3 ${voiceOn ? '' : 'hidden'}`}>
                  {together && <span className="rounded-full px-3 py-0.5 text-sm font-black text-black" style={{ background: who?.color }}>{who?.name}</span>}
                  <span data-testid={k === 0 ? 'live-state' : undefined} className={`font-black ${together ? 'text-lg' : 'text-xl sm:text-2xl'} ${color}`}>{label}</span>
                  {lv?.note && <span data-testid={k === 0 ? 'live-note' : undefined} className="rounded-full bg-white/10 px-3 py-0.5 font-mono text-sm font-bold">{lv.note}</span>}
                </div>
                {together && <span data-testid={`score-${who?.name}`} className="grad-text absolute right-4 top-1.5 text-3xl font-black tabular-nums">{lv?.score ?? 0}</span>}
                {!together && !hasRef && notes === 'search' && <span className="absolute right-3 top-3 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/70">Noten werden gesucht …</span>}
                {!together && !hasRef && notes !== 'search' && <button className="absolute right-3 top-3 cursor-pointer rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-white/70 hover:bg-white/20" onClick={() => setShowMelody(true)}>Für diesen Song keine Noten gefunden · selbst laden</button>}
                {!together && verdict && <span key={verdict.n} className="pointer-events-none absolute right-4 bottom-3 rounded-full bg-white/15 px-4 py-1 text-xl font-black [animation:pop_.4s_both,fade-out_.5s_1.4s_forwards]">{verdict.text}</span>}
                <div className="absolute bottom-2.5 left-4 h-1.5 w-24 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-emerald-300 transition-[width] duration-100" style={{ width: `${(lv?.level ?? 0) * 100}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}

      {phase === 'ready' && (
        <div className={`relative z-10 p-4 transition-opacity duration-500 sm:p-6 ${hideUi ? 'pointer-events-none opacity-0' : ''}`}>
          <div className="relative h-5 cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); const t = tr.current; if (t) void t.seek(((e.clientX - r.left) / r.width) * t.duration()) }}>
            <div className="absolute inset-x-0 top-1.5 h-2 overflow-hidden rounded-full bg-white/15"><div ref={bar} className="grad h-full rounded-full" style={{ width: 0 }} /></div>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button className="btn-primary h-16 w-16 shrink-0 p-0" onClick={toggle} aria-label={paused ? 'Wiedergabe' : 'Pause'}><Icon name={paused ? 'play' : 'pause'} size={32} /></button>
            <button className="btn-icon shrink-0 bg-transparent" onClick={() => void tr.current?.seek(0)} aria-label="Von vorn"><Icon name="restart" /></button>
            <span ref={clock} className="font-mono text-sm tabular-nums text-white/60">0:00 / {fmtTime(track.durationMs / 1000)}</span>
            <div className="ml-auto flex items-center gap-2">
              {hasRef && <span className="hidden rounded-full bg-emerald-400/15 px-3 py-1.5 text-sm font-bold text-emerald-300 sm:inline">♪ Noten</span>}
              <button className="btn" data-testid="mode" onClick={() => setShowMode(true)}><Icon name="users" size={20} /><span className="hidden sm:inline">Modus</span></button>
              <button className="btn-icon" data-testid="settings" onClick={() => setShowSettings(true)} aria-label="Einstellungen" title="Lautstärke, Text-Versatz, Mikrofon, Noten"><Icon name="sliders" /></button>
              <button className="btn-icon" onClick={fullscreen} aria-label="Vollbild"><Icon name="full" /></button>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <Modal onClose={() => setShowSettings(false)}>
          <div className="flex items-start gap-4">
            <h2 className="flex-1 text-3xl font-black tracking-tight">Einstellungen</h2>
            <button className="btn-icon" onClick={() => setShowSettings(false)} aria-label="Schließen"><Icon name="close" /></button>
          </div>
          <div className="mt-5 divide-y divide-white/10">
            {tr.current?.kind === 'browser' && (
              <label className="flex items-center gap-4 py-4">
                <span className="w-32 shrink-0 font-bold">Lautstärke</span>
                <input className="flex-1" type="range" min={0} max={1} step={0.02} value={settings.volume} aria-label="Lautstärke" onChange={(e) => { const v = +e.target.value; setSettings({ volume: v }); tr.current?.setVolume(v) }} />
              </label>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <span className="w-32 shrink-0 font-bold">Text-Versatz</span>
              <div className="flex items-center rounded-full bg-white/10">
                <button className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => shift(-0.25)} aria-label="Text früher">früher</button>
                <span className="w-16 text-center font-bold tabular-nums">{offset > 0 ? '+' : ''}{offset.toFixed(2).replace('.', ',')} s</span>
                <button className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => shift(0.25)} aria-label="Text später">später</button>
              </div>
              <span className="basis-full text-sm text-white/50">Kommen Text und Noten zu früh oder zu spät? Hier verschieben – wird je Song gemerkt.{!hasRef && lines.length > 0 && diff >= 2 ? ' Hinweis: Die gefundene Textfassung ist anders lang als die Spotify-Aufnahme.' : ''}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <span className="w-32 shrink-0 font-bold">Noten</span>
              <span className="flex-1 text-white/70">{hasRef ? `Geladen (${us?.notes} Noten)` : notes === 'search' ? 'Werden gesucht …' : 'Für diesen Song keine gefunden'}</span>
              <button className="btn" onClick={() => { setShowSettings(false); setShowMelody(true) }}>{hasRef ? 'Ändern' : 'Eigene Datei laden'}</button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <span className="w-32 shrink-0 font-bold">Mikrofon</span>
              <span className="flex-1 text-white/70">{voiceOn && !micOn ? 'Handy-Mikrofon' : !micOn ? 'Aus' : settings.micMode === 'speaker' ? 'Dieses Gerät · Lautsprecher' : 'Dieses Gerät · Kopfhörer'}
</span>
              <button className="btn" onClick={() => { setShowSettings(false); setShowMic(true) }}>Ändern</button>
            </div>
            {voiceOn && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
                <span className="w-32 shrink-0 font-bold">Stimm-Verzögerung</span>
                <div className="flex items-center rounded-full bg-white/10">
                  <button data-testid="lag-minus" className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => nudgeLag(-2)} aria-label="Weniger Verzögerung ausgleichen">−</button>
                  <span data-testid="lag-value" className="w-24 text-center font-bold tabular-nums">{Math.round((lagShown > 0.001 || lagShown < 0 ? lagShown : turn.pids.some((pid) => phones.some((ph) => ph.pid === pid)) ? autoLag.current.phone : autoLag.current.local) * 1000)} ms</span>
                  <button data-testid="lag-plus" className="h-11 cursor-pointer rounded-full px-4 font-bold hover:bg-white/15" onClick={() => nudgeLag(2)} aria-label="Mehr Verzögerung ausgleichen">+</button>
                </div>
                <span className="basis-full text-sm text-white/50">Die App stellt das selbst ein. Füllen sich die Röhren trotzdem erst hinter dem Zeiger: „+“ drücken. Füllen sie sich zu früh: „−“.</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-4">
              <span className="w-32 shrink-0 font-bold">Wiedergabe</span>
              <span className="flex-1 text-white/70">Spotify · {device}</span>
              {tr.current?.kind === 'browser' && <button className="btn" onClick={() => { setShowSettings(false); void start('remote') }}>Anderes Gerät</button>}
            </div>
          </div>
        </Modal>
      )}

      {bleed && phase === 'ready' && (
        <div className="rise fixed left-1/2 top-24 z-40 flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-2xl bg-yellow-300 px-4 py-3 text-sm font-semibold text-black shadow-2xl">
          <span>Die Musik ist im Mikrofon sehr laut. Stell sie etwas leiser oder nimm Kopfhörer – sonst erkennt die App deine Stimme schlecht.</span>
          <button className="shrink-0 cursor-pointer rounded-full bg-black/15 px-3 py-1" onClick={() => setBleed(false)}>OK</button>
        </div>
      )}
      {hideUi && <button aria-label="Bedienung einblenden" className="fixed inset-0 z-30 cursor-none" onClick={() => setIdle(false)} />}
      {(phase === 'mic' || showMic) && <MicDialog current={micOn ? settings.micMode : 'off'} first={phase === 'mic'} onChoose={chooseMic} onClose={phase === 'mic' ? undefined : () => setShowMic(false)} phone={<PhonePanel compact auto />} />}
      {showMode && <ModeDialog profiles={profiles} current={turn.pids[0]} sections={sections} phones={phones.map((ph) => ph.pid)} onStart={startMode} onClose={() => setShowMode(false)} />}
      {showMelody && <MelodyDialog track={track} loaded={us} onApply={applyMelody} onClose={() => setShowMelody(false)} />}
    </div>
  )
}

function ModeDialog({ profiles, current, sections, phones, onStart, onClose }: { profiles: { id: string; name: string; color: string }[]; current: string; sections: Section[]; phones: string[]; onStart(pids: string[], part: Section | null, style: 'simul' | 'pass' | 'duel'): void; onClose(): void }) {
  // sind Handys verbunden, singen standardmäßig deren Besitzer
  const [pids, setPids] = useState<string[]>(() => (phones.length ? phones.slice(0, 4) : [current]))
  const [part, setPart] = useState(-1)
  const [style, setStyle] = useState<'simul' | 'pass' | 'duel'>(phones.length > 1 ? 'simul' : 'duel')
  const canSimul = pids.length > 1 && pids.every((id) => phones.includes(id))
  const eff = style === 'simul' && !canSimul ? 'duel' : style
  const flip = (id: string) => setPids((l) => (l.includes(id) ? (l.length > 1 ? l.filter((x) => x !== id) : l) : l.length < 4 ? [...l, id] : l))
  const multi = pids.length > 1
  return (
    <Modal onClose={onClose} wide>
      <div className="flex items-start gap-4">
        <h2 className="flex-1 text-3xl font-black tracking-tight">Spielmodus</h2>
        <button className="btn-icon" onClick={onClose} aria-label="Schließen"><Icon name="close" /></button>
      </div>
      <p className="label mt-5">Wer singt? (bis zu 4, Reihenfolge = Antippen)</p>
      <div className="flex flex-wrap gap-2">
        {profiles.map((pr) => {
          const k = pids.indexOf(pr.id)
          return (
            <button key={pr.id} data-testid={`pl-${pr.name}`} onClick={() => flip(pr.id)} className={`flex cursor-pointer items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-4 font-semibold transition ${k >= 0 ? 'border-white/60 bg-white/15' : 'border-white/10 text-white/60 hover:bg-white/10'}`}>
              <span className="flex h-9 w-9 items-center justify-center rounded-full font-black text-black" style={{ background: pr.color }}>{k >= 0 ? k + 1 : pr.name.slice(0, 1).toUpperCase()}</span>{pr.name}
              {phones.includes(pr.id) && <Icon name="mic" size={16} className="text-emerald-300" />}
            </button>
          )
        })}
      </div>
      {profiles.length < 2 && <p className="mt-2 text-sm text-white/50">Weitere Sänger legst du unter „Karaoke-Abend“ an – oder sie verbinden einfach ihr Handy.</p>}
      <p className="label mt-5">Handy-Mikrofone</p>
      <div className="rounded-2xl border border-white/10 p-4"><PhonePanel compact /></div>

      {multi && (
        <>
          <p className="label mt-5">Ablauf</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {([['simul', 'Gleichzeitig', canSimul ? 'Alle singen zusammen, jeder mit eigener Notenbahn und eigenen Punkten.' : 'Braucht für jeden Sänger ein verbundenes Handy-Mikrofon.'], ['duel', 'Duell', 'Alle singen nacheinander denselben Teil – wer trifft besser?'], ['pass', 'Mikro weitergeben', 'Ein Durchlauf, abwechselnd: bei ganzem Song je Abschnitt, bei einem Teil je Zeile.']] as const).map(([id, title, text]) => (
              <button key={id} data-testid={`style-${id}`} disabled={id === 'simul' && !canSimul} onClick={() => setStyle(id)} className={`cursor-pointer rounded-2xl border p-4 text-left transition disabled:cursor-default disabled:opacity-45 ${eff === id ? 'border-white/60 bg-white/10' : 'border-white/10 hover:bg-white/5'}`}>
                <span className="block text-lg font-bold">{title}</span><span className="text-sm text-white/60">{text}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="label mt-5">Was wird gesungen?</p>
      <div className="scroll-thin max-h-64 space-y-1.5 overflow-y-auto pr-1">
        <button onClick={() => setPart(-1)} className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left ${part === -1 ? 'border-white/60 bg-white/10' : 'border-white/10 hover:bg-white/5'}`}><span className="text-lg font-bold">Ganzer Song</span></button>
        {sections.map((sec, i) => (
          <button key={i} data-testid={`sec-${i}`} onClick={() => setPart(i)} className={`flex w-full cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left ${part === i ? 'border-white/60 bg-white/10' : 'border-white/10 hover:bg-white/5'}`}>
            <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${sec.label === 'Refrain' ? 'grad text-white' : 'bg-white/10'}`}>{sec.label}</span>
            <span className="min-w-0 flex-1 truncate text-white/80">{sec.first}</span>
            <span className="shrink-0 font-mono text-sm text-white/45">{fmtTime(sec.s)} · {Math.round(sec.e - sec.s)} s</span>
          </button>
        ))}
        {!sections.length && <p className="text-white/50">Für diesen Song liegt kein synchroner Text vor – einzelne Abschnitte gibt es deshalb nicht.</p>}
      </div>
      <button data-testid="mode-start" className="btn-primary mt-6 w-full py-4 text-lg" onClick={() => onStart(pids, part >= 0 ? sections[part] : null, eff)}><Icon name="play" />Los geht's</button>
    </Modal>
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
