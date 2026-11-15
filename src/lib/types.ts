export interface LyricLine { t: number; text: string }

export interface Melody {
  fps: number
  /** MIDI-Note je Frame, 0 = kein Gesang */
  data: Float32Array
  source: 'stems' | 'center' | 'mix'
}

export interface Song {
  id: string
  title: string
  artist: string
  duration: number
  addedAt: number
  audio: Blob
  cover?: Blob
  lyrics?: LyricLine[]
  /** Hochwertige Stems (z. B. von Demucs) – optional */
  stems?: { vocals: Blob; instrumental: Blob }
  melody?: Melody
  favorite: boolean
  lastPlayed?: number
  playCount: number
  isDemo?: boolean
}

export interface Profile { id: string; name: string; color: string }

export interface ScoreParts { pitch: number; rhythm: number; timing: number; continuity: number }

export interface ScoreResult {
  total: number
  accuracy: number
  stars: number
  award: { title: string; emoji: string; text: string }
  parts: ScoreParts
  /** Anteil der Gesangspassagen, die tatsächlich gespielt wurden */
  played: number
  valid: boolean
}

export interface ScoreEntry {
  id: string
  songId: string
  songTitle: string
  artist: string
  profileId: string
  profileName: string
  total: number
  accuracy: number
  stars: number
  award: string
  date: number
}

export interface SpTrack { id: string; uri: string; name: string; artists: string; album: string; cover: string; coverSmall: string; durationMs: number }

/** Eintrag der Warteschlange: eigener Song (songId) oder Spotify-Titel (spotify) */
export interface QueueItem { qid: string; songId: string; profileId: string; spotify?: SpTrack }
