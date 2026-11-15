// LRCLIB: offene, kostenlose Datenbank für synchronisierte Liedtexte (kein API-Key, kein Tracking).
export interface LyricsHit { id: number; trackName: string; artistName: string; albumName?: string; duration: number; syncedLyrics?: string; plainLyrics?: string }

export async function searchLyrics(title: string, artist: string): Promise<LyricsHit[]> {
  const p = new URLSearchParams()
  if (title) p.set('track_name', title)
  if (artist) p.set('artist_name', artist)
  const r = await fetch('https://lrclib.net/api/search?' + p.toString())
  if (!r.ok) throw new Error('Liedtext-Suche nicht erreichbar (' + r.status + ')')
  return (await r.json()) as LyricsHit[]
}
