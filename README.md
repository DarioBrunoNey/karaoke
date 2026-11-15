# Encore – Karaoke-App (PWA)

Karaoke mit eigenen Audiodateien: Gesang herausrechnen, synchronen Liedtext anzeigen, über das
**eingebaute Mikrofon** live die Tonhöhe erkennen und den Auftritt bewerten. Läuft komplett im Browser –
kein Backend, kein Konto, kein Upload.

## Starten

```bash
npm install
npm run dev        # Entwicklung: http://localhost:5173
npm run build      # Produktion → dist/ (statische Dateien, überall hostbar)
npm run preview    # gebaute Version lokal ansehen
```

Mikrofonzugriff erlaubt der Browser nur über **https** oder **localhost**. Für Fernseher/Tablet/Handy
also `dist/` auf einen https-Webspace legen (beliebiger statischer Hoster) und dort „Zum Startbildschirm
hinzufügen" bzw. „App installieren" wählen.

## Was funktioniert (Version 0.1)

| Bereich | Stand |
|---|---|
| Eigene Dateien (MP3, WAV, M4A, FLAC, OGG) inkl. Titel/Interpret/Cover aus den Tags | ✔ |
| Gesangstrennung im Browser (STFT-Mitten-Extraktion, Stereo) – Regler „Originalgesang" | ✔ |
| Studio-Trennung per Demucs (lokaler Dienst `server/demucs_server.py`) oder fertige Stems laden | ✔ eingebaut, Dienst hier nicht mit echtem Modell getestet |
| Tonhöhe ±6 Halbtöne und Tempo 60–140 % unabhängig (SoundTouch im AudioWorklet) | ✔ |
| Liedtext: Online-Suche (LRCLIB), LRC einfügen/laden, selbst im Takt tippen | ✔ (Online-Suche in der Bauumgebung nicht erreichbar, daher ungetestet) |
| Echtzeit-Tonhöhenerkennung (YIN) über eingebautes Mikrofon, Kopfhörer- und Lautsprecher-Modus | ✔ |
| Bewertung 0–100 aus Tonhöhe, Rhythmus, Einsatz, Kontinuität + Sterne + Auszeichnung | ✔ |
| Bibliothek, Suche, Favoriten, zuletzt gesungen, Warteschlange, Sängerprofile, Bestenliste | ✔ |
| Vollbild, TV-Darstellung, automatisch ausblendende Bedienung, Bildschirm bleibt an, PWA/offline | ✔ |
| Duett-Modus, Fernbedienungs-Navigation per Pfeiltasten in der Bibliothek, Handy als Fernbedienung | geplant |

## Architektur

```
src/
├─ audio/
│  ├─ separate.worker.ts   Gesangstrennung (STFT) + Referenzmelodie, im Web Worker
│  ├─ melody.ts            Melodie aus der Gesangsspur (YIN, Glättung)
│  ├─ player.worklet.ts    Wiedergabe im Audio-Thread: Mix Gesang/Instrumental → SoundTouch
│  ├─ engine.ts            AudioContext, Laden, Transport, exakte Songposition
│  └─ mic.ts               Mikrofon → Filter → YIN → Note (nur lokal, keine Aufnahme)
├─ lib/
│  ├─ scoring.ts           Bewertungslogik (rein rechnerisch, ohne Zufall)
│  ├─ pitch.ts  lrc.ts  lyricsApi.ts  db.ts (IndexedDB)  demo.ts  importSong.ts
├─ views/                  Bibliothek, Player, Auswertung, Karaoke-Abend, Bestenliste, Hilfe, Song-Dialog
└─ store.ts                Zustand (zustand)
```

Technik: Vite + React + TypeScript + Tailwind CSS 4, Web Audio API (AudioWorklet), IndexedDB, vite-plugin-pwa.
Bewusst **kein Backend** und keine Datenbank auf einem Server: Profile und Bestenliste liegen auf dem Gerät.

## Tests

```bash
npm test                                    # Bewertungslogik + Melodie-Erkennung (Node)
npm run build && npm run preview -- --port 4173 &
NODE_PATH=$(npm root -g) node tests/e2e.mjs   # echter Browser, synthetischer Sänger als Mikrofon
NODE_PATH=$(npm root -g) node tests/check.mjs # Melodie-Genauigkeit, Tempo, Springen, Mobil-Layout
```

## Spotify / Amazon Music – warum nicht eingebunden

- **Spotify:** Web Playback SDK spielt nur DRM-geschützt ab – kein Zugriff aufs Audiosignal, also weder
  Gesangstrennung noch Tonhöhe/Tempo noch Melodie-Analyse. Die Web-API liefert keine Liedtexte. Die
  Developer Policy (Abschnitt III) verbietet zudem, Aufnahmen mit visuellen Inhalten zu synchronisieren.
- **Amazon Music:** Web-API ist eine geschlossene Beta nur für bereits zugelassene Partner; kein
  Wiedergabe-SDK für fremde Apps.
- **Legaler Weg:** Songs als kopierschutzfreie Datei kaufen (Amazon-MP3-Kauf, Qobuz, Bandcamp, iTunes) oder
  fertige Karaoke-Playbacks erwerben und importieren.

## Lizenzen der verwendeten Bausteine

soundtouchjs (LGPL-2.1, unverändert als Bibliothek eingebunden), music-metadata (MIT), idb (ISC),
zustand (MIT), React (MIT), Demucs (MIT, optional und getrennt). YIN, STFT-Trennung und Bewertung sind
eigene Implementierungen. Demo-Song: „Ode an die Freude" (gemeinfrei), im Browser synthetisiert.

Rechtlicher Hinweis: Bearbeitung eigener, legal erworbener Dateien für den privaten Gebrauch. Öffentliche
Aufführung (Lokal, Veranstaltung, Gästebereich) erfordert eine GEMA-Lizenz.
