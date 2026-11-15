import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Profile, ScoreEntry, Song } from './types'

interface Schema extends DBSchema {
  songs: { key: string; value: Song }
  profiles: { key: string; value: Profile }
  scores: { key: string; value: ScoreEntry; indexes: { bySong: string } }
}

let dbp: Promise<IDBPDatabase<Schema>> | null = null
const db = () =>
  (dbp ??= openDB<Schema>('encore', 1, {
    upgrade(d) {
      d.createObjectStore('songs', { keyPath: 'id' })
      d.createObjectStore('profiles', { keyPath: 'id' })
      d.createObjectStore('scores', { keyPath: 'id' }).createIndex('bySong', 'songId')
    },
  }))

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

export const Db = {
  songs: async () => (await db()).getAll('songs'),
  putSong: async (s: Song) => void (await (await db()).put('songs', s)),
  deleteSong: async (id: string) => void (await (await db()).delete('songs', id)),
  profiles: async () => (await db()).getAll('profiles'),
  putProfile: async (p: Profile) => void (await (await db()).put('profiles', p)),
  deleteProfile: async (id: string) => void (await (await db()).delete('profiles', id)),
  scores: async () => (await db()).getAll('scores'),
  putScore: async (s: ScoreEntry) => void (await (await db()).put('scores', s)),
  clearScores: async () => void (await (await db()).clear('scores')),
}
