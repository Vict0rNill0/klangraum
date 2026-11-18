# Klangraum

Ein kleines, deutschsprachiges Audio-Pult für Computer, Smartphone und Schultouchscreen.

- Mikrofon auswählen, Pegel sehen und optional über die Lautsprecher verstärken
- Zusätzliche Mikrofone verwenden, soweit Gerät und Browser das unterstützen
- Nur Mikrofonstimmen aufnehmen; Clips anhören, benennen, löschen und ausdrücklich herunterladen
- Lokale Audiodateien abspielen und YouTube-Videos nach einem bewussten Klick einbetten
- Keine Uploads, Analysewerkzeuge, Konten oder dauerhaften Browserspeicher

## Starten

Die Dateien werden unverändert über GitHub Pages veröffentlicht. Keine Build-Schritte, Laufzeit-Abhängigkeiten oder externen Schriftarten.

Lokal: `npm start` (oder `python3 -m http.server 43187 --bind 127.0.0.1`), dann <http://localhost:43187> öffnen. Mikrofone benötigen HTTPS oder localhost.

## Audio & Datenschutz

`app.js` verbindet ausschließlich Mikrofonquellen mit dem Aufnahmebus. Der Verstärkungspegel beeinflusst die Aufnahme nicht. Lokale Musik und Clip-Wiedergabe nutzen eigenständige Audioelemente; YouTube läuft in einem isolierten Iframe auf `youtube-nocookie.com`. Es gibt vor dem bewussten Laden eines Videos keine YouTube-Verbindung.

Clips und Audiodateien werden nur über flüchtige JavaScript-Objekte und Blob-URLs verwaltet. Neuladen/Schließen verwirft sie; nur der Downloadknopf löst einen Datei-Download aus. Browser können intern temporäre Mediendaten verwalten. GitHub Pages und aktivierte YouTube-Einbettungen verarbeiten technische Verbindungsdaten. Die ausführliche Erklärung steht im Info-Dialog.

Eine Aufnahme endet nach 15 Minuten, 100 MB oder bei erkannter Mikrofon-/Audio-Unterbrechung. Downloadformat ist browserabhängig: üblicherweise WebM/Opus in Chromium/Firefox, M4A in Safari. Kein MP3-Encoding. Mikrofone können Schall aus Lautsprechern akustisch mit aufnehmen.

Verstärkung startet ausgeschaltet mit 25 % Lautstärke. Abstand/Kopfhörer helfen gegen Rückkopplung. „Alles stumm“ deaktiviert Verstärkung und pausiert alle Player, beendet aber keine laufende Aufnahme.

## Browser

Aktuelle Versionen von Chrome, Edge, Firefox und Safari mit Web Audio, getUserMedia und MediaRecorder. Mobile Geräte können Eingangswahl/Mehrfachmikrofone einschränken. Auf iOS sind Aufnahmen im Vordergrund mit aktivem Display am zuverlässigsten. Unterstützte Audiodateien hängen vom jeweiligen Browser ab. Einbettung kann durch YouTube, Alters-/Regionsgrenzen oder Netzwerkfilter blockiert sein.
