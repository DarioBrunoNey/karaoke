import { useStore } from '../store'
import { redirectUri } from '../spotify/api'
import { diagClear, diagText } from '../lib/diag'

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="glass p-6 sm:p-8"><h2 className="mb-3 text-2xl font-black tracking-tight">{title}</h2><div className="space-y-3 leading-relaxed text-white/70">{children}</div></section>
)

export default function Info() {
  const { settings, setSettings } = useStore()
  return (
    <div className="grid gap-6 pb-10 pt-2 lg:grid-cols-2">
      <Card title="So funktioniert's">
        <p><b className="text-white">1. Song hinzufügen</b> – eigene Audiodatei (MP3, WAV, M4A, FLAC, OGG). Titel, Interpret und Cover werden aus der Datei gelesen.</p>
        <p><b className="text-white">2. Liedtext ergänzen</b> – online suchen (synchronisiert, LRCLIB), LRC einfügen oder selbst im Takt tippen.</p>
        <p><b className="text-white">3. Singen</b> – der Gesang wird beim Laden herausgerechnet, das eingebaute Mikrofon erkennt deine Tonhöhe und vergleicht sie mit der Originalmelodie.</p>
        <p>Tastatur: <kbd>Leertaste</kbd> Pause · <kbd>F</kbd> Vollbild · <kbd>←/→</kbd> 5 s springen · <kbd>Esc</kbd> beenden.</p>
      </Card>
      <Card title="Spotify & Amazon Music">
        <p><b className="text-white">Spotify:</b> Die offizielle Schnittstelle erlaubt Premium-Wiedergabe im Browser, gibt aber keinen Zugriff auf das Audiosignal (DRM). Gesang entfernen, Tonhöhe/Tempo ändern und die Melodie-Analyse sind damit technisch ausgeschlossen. Liedtexte liefert die API nicht, und die Entwicklerrichtlinie untersagt, Aufnahmen mit visuellen Inhalten zu synchronisieren.</p>
        <p><b className="text-white">Amazon Music:</b> Die Web-API ist eine geschlossene Beta nur für freigeschaltete Partner; eine Wiedergabe in fremden Apps gibt es nicht.</p>
        <p><b className="text-white">Was geht:</b> ein <b className="text-white">Mitsing-Modus</b> – Spotify spielt die Originalaufnahme, die App zeigt den Text synchron dazu (Bibliothek → „Spotify (Mitsingen)“). Nur für den privaten Gebrauch mit eigenem Entwicklerzugang.</p>
        <p><b className="text-white">Volles Karaoke mit Punkten:</b> Songs als Datei kaufen (z. B. MP3-Kauf bei Amazon, Qobuz, Bandcamp, iTunes – kopierschutzfrei) oder fertige Karaoke-Playbacks erwerben und hier hinzufügen. Die Streaming-Abos selbst lassen sich nicht einbinden.</p>
      </Card>
      <Card title="Spotify-Mitsing-Modus einrichten">
        <p>Einmalig, etwa fünf Minuten, benötigt Spotify Premium:</p>
        <p><b className="text-white">1.</b> Auf <b className="text-white">developer.spotify.com/dashboard</b> anmelden und „Create app“ wählen. Name und Beschreibung sind frei.</p>
        <p><b className="text-white">2.</b> Als „Redirect URI“ exakt diese Adresse eintragen:</p>
        <p><code className="block select-all break-all rounded-xl bg-black/40 px-3 py-2 text-white">{redirectUri()}</code></p>
        <p><b className="text-white">3.</b> Bei den APIs „Web API“ und „Web Playback SDK“ ankreuzen, speichern.</p>
        <p><b className="text-white">4.</b> Die angezeigte „Client ID“ hier eintragen (das ist kein Passwort; ein „Client secret“ wird nicht gebraucht):</p>
        <label className="block">
          <span className="label">Spotify Client-ID</span>
          <input className="field font-mono" placeholder="32 Zeichen" value={settings.spotifyClientId} onChange={(e) => setSettings({ spotifyClientId: e.target.value.trim() })} />
        </label>
        <p className="text-sm text-white/50">Die Kennung gilt je Gerät und Adresse. Wer die App auf einem weiteren Gerät nutzt, trägt dieselbe Client-ID dort noch einmal ein.</p>
      </Card>
      <Card title="Mikrofon & Datenschutz">
        <p>Das Mikrofonsignal wird ausschließlich auf diesem Gerät in Echtzeit analysiert. Es wird <b className="text-white">nichts aufgezeichnet und nichts übertragen</b>. Songs, Profile und Ergebnisse liegen nur im Browser-Speicher dieses Geräts.</p>
        <p><b className="text-white">Kopfhörer-Modus</b> liefert die genaueste Bewertung. Im <b className="text-white">Lautsprecher-Modus</b> filtert die Echo-Unterdrückung des Browsers die Musik aus dem Mikrofonsignal – das klappt gut bei moderater Lautstärke, aber nie perfekt.</p>
        <div className="pt-2">
          <span className="label">Schwierigkeit der Bewertung</span>
          <div className="flex flex-wrap gap-2">
            {([['leicht', 'Leicht', '±1¼ Halbtöne'], ['mittel', 'Mittel', '±¾ Halbton'], ['schwer', 'Schwer', '±½ Halbton']] as const).map(([id, name, tol]) => (
              <button key={id} onClick={() => setSettings({ difficulty: id })} className={`chip ${settings.difficulty === id ? 'chip-on' : ''}`}>{name} <span className="font-normal opacity-60">{tol}</span></button>
            ))}
          </div>
          <span className="text-sm text-white/50">So genau muss ein Ton sitzen, damit er als getroffen zählt. Gilt ab dem nächsten Song.</span>
        </div>
        <label className="block pt-2">
          <span className="label">Mikrofon-Verzögerung ausgleichen: {settings.micOffsetMs} ms</span>
          <input type="range" min={0} max={1500} step={10} value={settings.micOffsetMs} onChange={(e) => setSettings({ micOffsetMs: +e.target.value })} className="w-full" />
          <span className="text-sm text-white/50">Bei Bluetooth-Kopfhörern/-Boxen erhöhen (typisch 150–300 ms). Wird das Bild drahtlos auf den Fernseher übertragen, kommt der Ton dort später an – dann deutlich erhöhen (300–1000 ms), bis Treffer wieder als Treffer zählen.</span>
        </label>
      </Card>
      <Card title="Gesangstrennung">
        <p><b className="text-white">Sofort im Browser:</b> Mitten-Extraktion – entfernt mittig gemischten Leadgesang aus Stereo-Aufnahmen in wenigen Sekunden, ohne Upload. Qualität je nach Abmischung gut bis mittel; Mono-Aufnahmen lassen sich so nicht trennen.</p>
        <p><b className="text-white">Studioqualität (optional):</b> Der mitgelieferte lokale Demucs-Dienst (Open Source, MIT-Lizenz) trennt Gesang und Instrumental per KI auf deinem eigenen Rechner. Adresse hier eintragen, dann im Song-Dialog „HD-Trennung" wählen.</p>
        <label className="block">
          <span className="label">Adresse des Demucs-Dienstes</span>
          <input className="field" placeholder="http://localhost:8765" value={settings.demucsUrl} onChange={(e) => setSettings({ demucsUrl: e.target.value.trim() })} />
        </label>
        <p className="text-sm text-white/50">Hinweis: Bearbeitung nur für den privaten Gebrauch eigener, legal erworbener Dateien. Öffentliche Aufführungen (Lokal, Veranstaltung, Gästebereich) benötigen eine GEMA-Lizenz.</p>
      </Card>
      <Card title="Diagnose">
        <p>Startet ein Song nicht? Hier steht, an welcher Stelle es hing. Das Protokoll liegt nur auf diesem Gerät.</p>
        <textarea readOnly data-testid="diag" className="field scroll-thin h-44 font-mono text-xs" value={diagText() || 'Noch keine Einträge.'} />
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => void navigator.clipboard?.writeText(diagText())}>Kopieren</button>
          <button className="btn" onClick={() => { diagClear(); location.reload() }}>Leeren</button>
        </div>
      </Card>
      <p data-testid="build" className="text-sm text-white/40 lg:col-span-2">App-Stand: {__BUILD__} Uhr · aktualisiert sich selbst; bei Zweifeln die Seite neu laden.</p>
    </div>
  )
}
