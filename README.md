# ClipBay

> Schneller, lokaler Media-Asset-Browser für Premiere Pro — Open Source, kein Abo.

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![Electron](https://img.shields.io/badge/built%20with-Electron-47848F)

Ordner werden **in-place** indexiert (nichts wird kopiert), Vorschauen entstehen über
**ffmpeg**, und Assets ziehst du per **Drag-and-Drop direkt in die Premiere-Timeline**.
Gedacht als kostenlose Alternative zu Eagle / Billfish / Soundly — speziell für Cutter,
die schnell durch Footage **und** Sound-Effekte **und** Musik browsen wollen.

## Features

- 📁 **Ordner hinzufügen statt importieren** — liest deine bestehenden Ordner direkt, keine Doppel-Kopien.
- 🎞️ **Video-Hover-Scrub** — beim Drüberfahren scrubbst du durch den Clip (vorgerenderte 5×5-Sprite-Sheets → instant, kein Decode pro Hover).
- 🔊 **Audio-Vorschau mit Waveform** — Welle im Grid; mit der Maus drüberfahren = scrubben + anhören.
- 🔎 **Universelle Suche** — über Name, Ordner und Tags.
- ⭐ **Favoriten & Farb-Labels** — wie in Premiere/Finder, inkl. Filter nach Farbe.
- 🧰 **Filter** — Alle / Favoriten / Video / Audio / Bilder.
- 🔍 **Größen-Slider** — Vorschaukarten stufenlos größer/kleiner (wird gespeichert).
- 🖼️ **Detail-Vorschau (Doppelklick)** — Datei groß im Fenster ansehen, abspielen, scrubben, framegenau steppen.
- ✂️ **In/Out-Points** — Ausschnitt setzen (I/O-Tasten), per ffmpeg schneiden und als Clip in Premiere ziehen.
- 🖱️ **Drag-and-Drop nach Premiere** — zieht die echte Originaldatei (oder den getrimmten Ausschnitt) ins Projekt-/Timeline-Fenster.

## Voraussetzungen

- **Node.js** ≥ 18
- **ffmpeg** & **ffprobe** im PATH
  - Windows: `winget install Gyan.FFmpeg`
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`

> ClipBay liefert ffmpeg **nicht** mit, sondern nutzt deine System-Installation. Siehe [NOTICE.md](NOTICE.md).

## Installation & Start

```bash
git clone https://github.com/<dein-user>/clipbay.git
cd clipbay
npm install
npm start
```

Unter Windows alternativ: Doppelklick auf **`Start ClipBay.bat`**.

## So funktioniert's

1. „Ordner hinzufügen" → SFX-/Footage-/Musik-Ordner wählen.
2. ClipBay scannt rekursiv und erstellt im Hintergrund Thumbnails, Hover-Sprites und Waveforms.
   Cache liegt unter `%APPDATA%/clipbay/cache` (macOS/Linux: `~/.config/clipbay`).
   **Deine Originaldateien werden nie verändert.**
3. Suchen, mit ⭐/Farbe markieren, per Hover vorschauen.
4. Karte greifen und in die Premiere-Timeline ziehen.

## Technik

- **Electron** — Desktop-App, nativer File-Drag heraus via `webContents.startDrag`
- **ffmpeg/ffprobe** — Metadaten, Thumbnails, 5×5-Sprite-Sheets, `showwavespic`-Waveforms
- **JSON-Index** — bewusst ohne native Module (kein C++-Toolchain nötig).
  Für sehr große Bibliotheken später auf SQLite umstellbar.

## Roadmap

- [x] Größen-Slider für Vorschaukarten
- [x] Detail-/Player-Fenster (Doppelklick) mit In/Out und Ausschnitt-Export
- [ ] Datei-Watcher (neue Dateien automatisch erkennen)
- [ ] Eigene Tags/Sammlungen als Sidebar-Einträge
- [ ] Optionaler echter Proxy-Clip für flüssige Vollvorschau
- [ ] SQLite-Backend + Volltextsuche für 50k+ Assets
- [ ] macOS-/Linux-Builds & Auto-Update

## Mitwirken

Issues und Pull Requests sind willkommen. Forke das Repo, erstelle einen Branch
und öffne einen PR mit einer kurzen Beschreibung.

## Lizenz

[MIT](LICENSE) — frei nutzbar, auch kommerziell. ffmpeg-Hinweise siehe [NOTICE.md](NOTICE.md).
