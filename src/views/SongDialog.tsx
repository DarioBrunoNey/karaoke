import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { Icon, Modal, fmtTime, useBlobUrl } from '../ui'
import { isLrc, parseLrc, toLrc } from '../lib/lrc'
import { searchLyrics, type LyricsHit } from '../lib/lyricsApi'
import type { LyricLine } from '../lib/types'

type Tab = 'search' | 'paste' | 'tap' | 'audio'

export default function SongDialog({ songId }: { songId: string }) {
  const { songs, updateSong, deleteSong, setEdit, say, settings } = useStore()
  const song = songs.find((s) => s.id === songId)
  const [title, setTitle] = useState(song?.title ?? '')
  const [artist, setArtist] = useState(song?.artist ?? '')
  const [tab, setTab] = useState<Tab>(song?.lyrics?.length ? 'paste' : 'search')
  const [text, setText] = useState(song?.lyrics?.length ? toLrc(song.lyrics) : '')
  const [hits, setHits] = useState<LyricsHit[] | null>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [tapLines, setTapLines] = useState<LyricLine[]>([])
  const [tapIdx, setTapIdx] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const audioUrl = useBlobUrl(tab === 'tap' ? song?.audio : undefined)
  const vocFile = useRef<HTMLInputElement>(null)
  const instFile = useRef<HTMLInputElement>(null)
  const [stemVoc, setStemVoc] = useState<File | null>(null)

  useEffect(() => {
    if (tab !== 'tap') return
    const k = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); tap() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })
  if (!song) return null
  const close = () => setEdit(null)

  const saveMeta = () => updateSong(song.id, { title: title.trim() || song.title, artist: artist.trim() || song.artist })
  const saveLyrics = async (lines: LyricLine[]) => {
    await updateSong(song.id, { title: title.trim() || song.title, artist: artist.trim() || song.artist, lyrics: lines.filter((l) => l.text.trim()) })
    say('Liedtext gespeichert'); close()
  }
  const startTap = (plain: string) => {
    setTapLines(plain.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((t) => ({ t: -1, text: t })))
    setTapIdx(0); setTab('tap')
  }
  const tap = () => {
    const a = audio.current
    if (!a || tapIdx >= tapLines.length) return
    if (a.paused) { void a.play(); return }
    const t = Math.max(0, a.currentTime - 0.15) // Reaktionszeit abziehen
    setTapLines((l) => l.map((x, i) => (i === tapIdx ? { ...x, t } : x)))
    setTapIdx(tapIdx + 1)
  }
  const search = async () => {
    setBusy('Suche …'); setErr(''); setHits(null)
    try { setHits(await searchLyrics(title, artist === 'Unbekannt' ? '' : artist)) }
    catch { setErr('Die Liedtext-Suche ist gerade nicht erreichbar. Text bitte einfügen oder selbst tippen.') }
    setBusy('')
  }
  const useHit = (h: LyricsHit) => {
    if (h.syncedLyrics) void saveLyrics(parseLrc(h.syncedLyrics))
    else if (h.plainLyrics) startTap(h.plainLyrics)
  }
  const usePaste = () => {
    if (!text.trim()) return void updateSong(song.id, { lyrics: [] }).then(close)
    if (isLrc(text)) void saveLyrics(parseLrc(text))
    else startTap(text)
  }
  const demucs = async () => {
    setBusy('KI-Trennung läuft – das dauert je nach Rechner 1–5 Minuten …'); setErr('')
    try {
      const base = settings.demucsUrl.replace(/\/$/, '')
      const fd = new FormData(); fd.append('file', song.audio, 'song')
      const r = await fetch(base + '/separate', { method: 'POST', body: fd })
      if (!r.ok) throw new Error(await r.text())
      const j = await r.json()
      const [vocals, instrumental] = await Promise.all([fetch(base + j.vocals).then((x) => x.blob()), fetch(base + j.instrumental).then((x) => x.blob())])
      await updateSong(song.id, { stems: { vocals, instrumental }, melody: undefined })
      say('HD-Trennung gespeichert')
    } catch (e) { setErr('Demucs-Dienst nicht erreichbar oder Fehler: ' + (e as Error).message) }
    setBusy('')
  }

  return (
    <Modal onClose={close} wide>
      <div className="flex items-start gap-4">
        <h2 className="flex-1 text-3xl font-black tracking-tight">Song bearbeiten</h2>
        <button className="btn-icon" onClick={close} aria-label="Schließen"><Icon name="close" /></button>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label><span className="label">Titel</span><input className="field" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveMeta()} /></label>
        <label><span className="label">Interpret</span><input className="field" value={artist} onChange={(e) => setArtist(e.target.value)} onBlur={() => void saveMeta()} /></label>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {([['search', 'Text online suchen'], ['paste', 'Text einfügen'], ['tap', 'Im Takt tippen'], ['audio', 'Audio & Trennung']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} className={`chip ${tab === t ? 'chip-on' : ''}`} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {err && <p className="mt-4 rounded-2xl bg-red-500/15 p-3 text-red-200">{err}</p>}
      {busy && <p className="mt-4 rounded-2xl bg-white/10 p-3">{busy}</p>}

      {tab === 'search' && (
        <div className="mt-5">
          <p className="text-white/60">Sucht synchronisierte Liedtexte in der offenen Datenbank LRCLIB. Übertragen werden nur Titel und Interpret.</p>
          <button className="btn-primary mt-3" onClick={() => void search()} disabled={!!busy || !title.trim()}><Icon name="search" />Suchen</button>
          {hits && hits.length === 0 && <p className="mt-4 text-white/60">Kein Treffer. Titel/Interpret prüfen oder Text selbst einfügen.</p>}
          <div className="mt-4 space-y-2">
            {hits?.slice(0, 12).map((h) => (
              <button key={h.id} disabled={!h.syncedLyrics && !h.plainLyrics} onClick={() => useHit(h)} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-white/10 p-3 text-left hover:bg-white/10 disabled:opacity-40">
                <div className="min-w-0 flex-1"><p className="truncate font-bold">{h.trackName}</p><p className="truncate text-sm text-white/55">{h.artistName}{h.albumName ? ' · ' + h.albumName : ''} · {fmtTime(h.duration)}</p></div>
                {Math.abs(h.duration - song.duration) < 3 && <span className="rounded-full bg-emerald-400/20 px-2.5 py-1 text-xs font-bold text-emerald-300">Länge passt</span>}
                <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${h.syncedLyrics ? 'bg-white text-black' : 'bg-white/10'}`}>{h.syncedLyrics ? 'synchron' : 'nur Text'}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'paste' && (
        <div className="mt-5">
          <p className="text-white/60">LRC-Format (<code>[00:12.50]Zeile</code>) wird direkt übernommen. Reiner Text wird danach im Takt getippt.</p>
          <textarea className="field scroll-thin mt-3 h-64 font-mono text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={'[00:12.50]Erste Zeile\n[00:17.80]Zweite Zeile'} />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={usePaste}>{isLrc(text) || !text.trim() ? 'Speichern' : 'Weiter: im Takt tippen'}</button>
            <label className="btn cursor-pointer">.lrc-Datei laden<input type="file" accept=".lrc,.txt" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()) }} /></label>
          </div>
        </div>
      )}

      {tab === 'tap' && (
        <div className="mt-5">
          {tapLines.length === 0 ? <p className="text-white/60">Füge zuerst unter „Text einfügen" den reinen Liedtext ein.</p> : (
            <>
              <p className="text-white/60">Song starten und jedes Mal tippen (Button oder Leertaste), wenn die markierte Zeile beginnt.</p>
              <audio ref={audio} src={audioUrl} controls className="mt-3 w-full" />
              <div className="scroll-thin mt-3 h-52 overflow-y-auto rounded-2xl bg-black/30 p-3">
                {tapLines.map((l, i) => (
                  <p key={i} ref={i === tapIdx ? (el) => el?.scrollIntoView({ block: 'center', behavior: 'smooth' }) : undefined} className={`rounded-lg px-2 py-1 ${i === tapIdx ? 'bg-white/15 text-lg font-bold' : i < tapIdx ? 'text-white/40' : 'text-white/70'}`}>
                    <span className="mr-3 font-mono text-xs text-white/40">{l.t >= 0 ? fmtTime(l.t) : '–:––'}</span>{l.text}
                  </p>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary flex-1 py-5 text-xl" onClick={tap} disabled={tapIdx >= tapLines.length}>{tapIdx >= tapLines.length ? 'Fertig' : 'Zeile beginnt jetzt'}</button>
                <button className="btn" onClick={() => { setTapIdx(0); setTapLines((l) => l.map((x) => ({ ...x, t: -1 }))); if (audio.current) audio.current.currentTime = 0 }}>Neu starten</button>
                <button className="btn" disabled={tapIdx === 0} onClick={() => void saveLyrics(tapLines.filter((l) => l.t >= 0))}>Speichern</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'audio' && (
        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border border-white/10 p-4">
            <p className="font-bold">Gesangstrennung: {song.stems ? 'HD-Stems vorhanden' : 'automatisch im Browser (Mitten-Extraktion)'}</p>
            <p className="mt-1 text-sm text-white/60">Für Studioqualität: lokalen Demucs-Dienst nutzen oder fertige Stems (Gesang + Instrumental) laden.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn" disabled={!settings.demucsUrl || !!busy} onClick={() => void demucs()} title={settings.demucsUrl ? '' : 'Adresse unter „Hilfe" eintragen'}>HD-Trennung (Demucs)</button>
              <button className="btn" onClick={() => vocFile.current?.click()}>{stemVoc ? '1/2 ✓ – jetzt Instrumental wählen' : 'Stems laden: Gesangsspur'}</button>
              {song.stems && <button className="btn" onClick={() => void updateSong(song.id, { stems: undefined, melody: undefined })}>Stems entfernen</button>}
            </div>
            <input ref={vocFile} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setStemVoc(f); instFile.current?.click() } }} />
            <input ref={instFile} type="file" accept="audio/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f && stemVoc) { await updateSong(song.id, { stems: { vocals: stemVoc, instrumental: f }, melody: undefined }); setStemVoc(null); say('Stems gespeichert') } }} />
          </div>
          <button className="btn border-red-400/30 text-red-300" onClick={() => { if (confirm(`„${song.title}" wirklich löschen?`)) { void deleteSong(song.id); close() } }}><Icon name="trash" size={18} />Song löschen</button>
        </div>
      )}
    </Modal>
  )
}
