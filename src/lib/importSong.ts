import { uid } from './db'
import type { Song } from './types'

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/i
export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)

function fromFilename(name: string) {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d+[\s.-]+/, '').trim()
  const m = base.split(/\s+[-–]\s+/)
  return m.length >= 2 ? { artist: m[0], title: m.slice(1).join(' - ') } : { artist: 'Unbekannt', title: base }
}

function probeDuration(blob: Blob): Promise<number> {
  return new Promise((res) => {
    const a = new Audio()
    const url = URL.createObjectURL(blob)
    const done = (d: number) => { URL.revokeObjectURL(url); res(d) }
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0)
    a.onerror = () => done(0)
    a.src = url
  })
}

export async function importAudioFile(file: File): Promise<Song> {
  const guess = fromFilename(file.name)
  let title = guess.title, artist = guess.artist, duration = 0
  let cover: Blob | undefined
  try {
    const mm = await import('music-metadata')
    const meta = await mm.parseBlob(file)
    if (meta.common.title) title = meta.common.title
    if (meta.common.artist) artist = meta.common.artist
    if (meta.format.duration) duration = meta.format.duration
    const pic = meta.common.picture?.[0]
    if (pic) cover = new Blob([pic.data as BlobPart], { type: pic.format })
  } catch { /* Datei ohne lesbare Tags – Dateiname genügt */ }
  if (!duration) duration = await probeDuration(file)
  return { id: uid(), title, artist, duration, addedAt: Date.now(), audio: file, cover, favorite: false, playCount: 0 }
}
