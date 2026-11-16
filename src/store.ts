import { create } from 'zustand'
import { Db, uid } from './lib/db'
import { buildDemoSong } from './lib/demo'
import { importAudioFile, isAudioFile } from './lib/importSong'
import type { Profile, QueueItem, ScoreEntry, ScoreResult, Song, SpTrack } from './lib/types'
import { finishLogin } from './spotify/api'
import type { MicMode } from './audio/mic'
import type { Difficulty } from './lib/scoring'
import { engine } from './audio/engine'
import { phoneUrl, startPhoneHost, type Phone } from './remote/host'

export interface Settings {
  micMode: MicMode | 'off'
  micAsked: boolean
  micOffsetMs: number
  difficulty: Difficulty
  volume: number
  demucsUrl: string
  spotifyClientId: string
}
const DEFAULTS: Settings = { micMode: 'headphones', micAsked: false, micOffsetMs: 90, difficulty: 'mittel', volume: 0.9, demucsUrl: '', spotifyClientId: '' }
const loadSettings = (): Settings => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('encore-settings') || '{}') } } catch { return DEFAULTS }
}

export type View =
  | { name: 'library' } | { name: 'party' } | { name: 'scores' } | { name: 'info' }
  | { name: 'player'; songId: string; profileId: string; qid?: string; run: number }
  | { name: 'spotify'; track: SpTrack; profileId: string; run: number }
  | { name: 'results'; songId: string; profileId: string; result: ScoreResult; micUsed: boolean; rank?: number }

const COLORS = ['#ff3d81', '#38bdf8', '#facc15', '#34d399', '#a855f7', '#fb923c', '#f472b6', '#22d3ee']

interface State {
  ready: boolean
  songs: Song[]
  profiles: Profile[]
  scores: ScoreEntry[]
  queue: QueueItem[]
  activeProfileId: string
  settings: Settings
  view: View
  editSongId: string | null
  libraryTab: 'all' | 'fav' | 'recent' | 'spotify'
  /** Handy-Mikrofone: verbundene Handys und Zustand der Verbindung */
  phones: Phone[]
  phoneHost: { state: 'off' | 'starting' | 'on' | 'error'; url: string; error: string }
  startPhones(): Promise<void>
  setLibraryTab(t: 'all' | 'fav' | 'recent' | 'spotify'): void
  toast: string | null
  init(): Promise<void>
  go(v: View): void
  say(msg: string): void
  setSettings(p: Partial<Settings>): void
  importFiles(files: File[]): Promise<void>
  updateSong(id: string, p: Partial<Song>): Promise<void>
  deleteSong(id: string): Promise<void>
  addProfile(name: string): Promise<Profile>
  removeProfile(id: string): Promise<void>
  setActiveProfile(id: string): void
  enqueue(songId: string, profileId?: string, spotify?: SpTrack): void
  playSpotify(track: SpTrack, profileId?: string, qid?: string): void
  dequeue(qid: string): void
  setQueueSinger(qid: string, profileId: string): void
  moveQueue(qid: string, dir: -1 | 1): void
  play(songId: string, profileId?: string, qid?: string): void
  playNext(): boolean
  finish(songId: string, profileId: string, result: ScoreResult, micUsed: boolean): Promise<void>
  clearScores(): Promise<void>
  addScore(e: Omit<ScoreEntry, 'id' | 'date'>): Promise<number>
  setEdit(id: string | null): void
}

let toastTimer = 0

export const useStore = create<State>((set, get) => ({
  ready: false, songs: [], profiles: [], scores: [], queue: [], activeProfileId: '',
  settings: loadSettings(), view: { name: 'library' }, editSongId: null, toast: null, libraryTab: 'all',
  phones: [], phoneHost: { state: 'off', url: '', error: '' },
  async startPhones() {
    if (get().phoneHost.state === 'on' || get().phoneHost.state === 'starting') return
    set({ phoneHost: { state: 'starting', url: '', error: '' } })
    try {
      const code = await startPhoneHost({
        profileFor: async (name) => (get().profiles.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? (await get().addProfile(name))).id,
        onChange: (phones) => set({ phones }),
      })
      set({ phoneHost: { state: 'on', url: phoneUrl(code), error: '' } })
    } catch (e) {
      set({ phoneHost: { state: 'error', url: '', error: (e as Error).message } })
    }
  },
  setLibraryTab: (libraryTab) => set({ libraryTab }),

  async init() {
    let [songs, profiles, scores] = await Promise.all([Db.songs(), Db.profiles(), Db.scores()])
    if (!profiles.length) {
      const p: Profile = { id: uid(), name: 'Sänger 1', color: COLORS[0] }
      await Db.putProfile(p); profiles = [p]
    }
    if (!songs.some((s) => s.isDemo) && !localStorage.getItem('encore-demo-removed')) {
      try { const demo = await buildDemoSong(); await Db.putSong(demo); songs = [...songs, demo] } catch (e) { console.warn(e) }
    }
    const active = localStorage.getItem('encore-active') || ''
    const login = await finishLogin()
    if (login) { set({ libraryTab: 'spotify' }); setTimeout(() => get().say(login === 'ok' ? 'Mit Spotify verbunden' : 'Spotify-Anmeldung fehlgeschlagen'), 300) }
    set({ ready: true, songs, profiles, scores, activeProfileId: profiles.some((p) => p.id === active) ? active : profiles[0].id })
  },

  go: (view) => set({ view }),
  say(msg) {
    set({ toast: msg })
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => set({ toast: null }), 3500)
  },
  setSettings(p) {
    const settings = { ...get().settings, ...p }
    localStorage.setItem('encore-settings', JSON.stringify(settings))
    set({ settings })
  },

  async importFiles(files) {
    const audio = files.filter(isAudioFile)
    if (!audio.length) return get().say('Keine Audiodatei erkannt (MP3, WAV, M4A, FLAC, OGG …)')
    for (const f of audio) {
      const song = await importAudioFile(f)
      await Db.putSong(song)
      set({ songs: [...get().songs, song] })
    }
    get().say(audio.length === 1 ? 'Song hinzugefügt – jetzt Liedtext ergänzen' : `${audio.length} Songs hinzugefügt`)
    if (audio.length === 1) set({ editSongId: get().songs[get().songs.length - 1].id })
  },
  async updateSong(id, p) {
    const cur = get().songs.find((s) => s.id === id)
    if (!cur) return
    const next = { ...cur, ...p }
    await Db.putSong(next)
    set({ songs: get().songs.map((s) => (s.id === id ? next : s)) })
  },
  async deleteSong(id) {
    await Db.deleteSong(id)
    if (get().songs.find((s) => s.id === id)?.isDemo) localStorage.setItem('encore-demo-removed', '1')
    set({ songs: get().songs.filter((s) => s.id !== id), queue: get().queue.filter((q) => q.songId !== id) })
  },

  async addProfile(name) {
    const p: Profile = { id: uid(), name: name.trim() || `Sänger ${get().profiles.length + 1}`, color: COLORS[get().profiles.length % COLORS.length] }
    await Db.putProfile(p)
    set({ profiles: [...get().profiles, p] })
    return p
  },
  async removeProfile(id) {
    if (get().profiles.length <= 1) return
    await Db.deleteProfile(id)
    const profiles = get().profiles.filter((p) => p.id !== id)
    set({
      profiles,
      activeProfileId: get().activeProfileId === id ? profiles[0].id : get().activeProfileId,
      queue: get().queue.map((q) => (q.profileId === id ? { ...q, profileId: profiles[0].id } : q)),
    })
  },
  setActiveProfile(id) { localStorage.setItem('encore-active', id); set({ activeProfileId: id }) },

  enqueue(songId, profileId, spotify) {
    const { queue, profiles, activeProfileId } = get()
    // Karaoke-Abend: ohne Angabe rotieren die Sänger reihum
    let pid = profileId
    if (!pid) {
      const last = queue[queue.length - 1]
      const idx = last ? profiles.findIndex((p) => p.id === last.profileId) : profiles.findIndex((p) => p.id === activeProfileId) - 1
      pid = profiles[(idx + 1 + profiles.length) % profiles.length].id
    }
    set({ queue: [...queue, { qid: uid(), songId, profileId: pid, spotify }] })
    get().say('Zur Warteschlange hinzugefügt')
  },
  dequeue: (qid) => set({ queue: get().queue.filter((q) => q.qid !== qid) }),
  setQueueSinger: (qid, profileId) => set({ queue: get().queue.map((q) => (q.qid === qid ? { ...q, profileId } : q)) }),
  moveQueue(qid, dir) {
    const q = [...get().queue]
    const i = q.findIndex((x) => x.qid === qid), j = i + dir
    if (i < 0 || j < 0 || j >= q.length) return
    ;[q[i], q[j]] = [q[j], q[i]]
    set({ queue: q })
  },

  play(songId, profileId, qid) {
    void engine.init().catch(() => {}) // AudioContext direkt im Klick entsperren (Safari/iOS)
    const pid = profileId ?? get().activeProfileId
    if (qid) set({ queue: get().queue.filter((q) => q.qid !== qid) })
    set({ view: { name: 'player', songId, profileId: pid, qid, run: Date.now() } })
  },
  playSpotify(track, profileId, qid) {
    void engine.init().catch(() => {}) // für das Mikrofon: AudioContext im Klick entsperren
    const pid = profileId ?? get().activeProfileId
    if (qid) set({ queue: get().queue.filter((q) => q.qid !== qid) })
    set({ view: { name: 'spotify', track, profileId: pid, run: Date.now() } })
  },
  playNext() {
    const next = get().queue[0]
    if (!next) return false
    if (next.spotify) get().playSpotify(next.spotify, next.profileId, next.qid)
    else get().play(next.songId, next.profileId, next.qid)
    return true
  },

  async finish(songId, profileId, result, micUsed) {
    const song = get().songs.find((s) => s.id === songId)
    const profile = get().profiles.find((p) => p.id === profileId)
    let rank: number | undefined
    if (song) await get().updateSong(songId, { lastPlayed: Date.now(), playCount: song.playCount + 1 })
    if (song && profile && micUsed && result.valid) {
      const entry: ScoreEntry = {
        id: uid(), songId, songTitle: song.title, artist: song.artist, profileId, profileName: profile.name,
        total: result.total, accuracy: result.accuracy, stars: result.stars, award: result.award.title, date: Date.now(),
      }
      await Db.putScore(entry)
      const scores = [...get().scores, entry]
      rank = scores.filter((s) => s.songId === songId && s.total > entry.total).length + 1
      set({ scores })
    }
    set({ view: { name: 'results', songId, profileId, result, micUsed, rank } })
  },
  async addScore(e) {
    const entry: ScoreEntry = { ...e, id: uid(), date: Date.now() }
    await Db.putScore(entry)
    const scores = [...get().scores, entry]
    set({ scores })
    return scores.filter((x) => x.songId === e.songId && x.total > e.total).length + 1
  },
  async clearScores() { await Db.clearScores(); set({ scores: [] }) },
  setEdit: (id) => set({ editSongId: id }),
}))
