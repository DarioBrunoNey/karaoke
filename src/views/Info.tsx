import { useStore } from '../store'

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
        <p><b className="text-white">Der legale Weg:</b> Songs als Datei kaufen (z. B. MP3-Kauf bei Amazon, Qobuz, Bandcamp, iTunes – kopierschutzfrei) oder fertige Karaoke-Playbacks erwerben und hier hinzufügen. Die Streaming-Abos selbst lassen sich nicht einbinden.</p>
      </Card>
      <Card title="Mikrofon & Datenschutz">
        <p>Das Mikrofonsignal wird ausschließlich auf diesem Gerät in Echtzeit analysiert. Es wird <b className="text-white">nichts aufgezeichnet und nichts übertragen</b>. Songs, Profile und Ergebnisse liegen nur im Browser-Speicher dieses Geräts.</p>
        <p><b className="text-white">Kopfhörer-Modus</b> liefert die genaueste Bewertung. Im <b className="text-white">Lautsprecher-Modus</b> filtert die Echo-Unterdrückung des Browsers die Musik aus dem Mikrofonsignal – das klappt gut bei moderater Lautstärke, aber nie perfekt.</p>
        <label className="block pt-2">
          <span className="label">Mikrofon-Verzögerung ausgleichen: {settings.micOffsetMs} ms</span>
          <input type="range" min={0} max={400} step={10} value={settings.micOffsetMs} onChange={(e) => setSettings({ micOffsetMs: +e.target.value })} className="w-full" />
          <span className="text-sm text-white/50">Bei Bluetooth-Kopfhörern/-Boxen oder Fernsehern mit Bildverzögerung erhöhen (typisch 150–300 ms).</span>
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
    </div>
  )
}
