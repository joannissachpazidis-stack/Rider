# 🎚 Rider-Ablage

Interaktive Ablage für Techrider, Inputlisten, Stageplots & Co. – für Tontechniker:innen, die Bands und ganze Konzerte mischen.

## Funktionen

- **Konzerte** mit Datum, Ort, Notizen und Line-up (Reihenfolge & Spielzeiten).
- **Unterlagen pro Band** (PDF, Bilder, Text, Excel … oder reine Notizen), sortiert nach Art: Techrider, Inputliste, Stageplot, Monitoring, Lichtrider, Hospitality, Kontakte, Notizen, Sonstiges.
- **Zuordnung zu Konzerten:** Jede Band im Konzert bekommt die passenden Unterlagen. Die Dateien liegen nur einmal bei der Band.
- **Rider-Abfrage:** Wird eine Band, für die es schon Unterlagen gibt, zu einem Konzert hinzugefügt, fragt die App bei jeder Unterlage: *Aktuell* (wird gleich zugeordnet), *Nicht nötig* oder *Veraltet* (wird archiviert, und du kannst sofort die neue Version hochladen).
- **Bands-Suche** und **globale Suche** über Bands, Konzerte, Orte, Dateinamen und Notizen.
- **Hinweise:** Rider, die seit über 12 Monaten nicht bestätigt wurden, sind als „alt?“ markiert. Konzerte zeigen, welche Bands noch keinen Rider haben.
- **Versionen:** Beim Hochladen werden ältere Unterlagen derselben Art automatisch als veraltet markiert. Ältere Konzerte behalten die Version, mit der sie gespielt wurden.
- **Art wird erkannt:** Aus dem Dateinamen (z. B. „Inputlist.pdf“ → Inputliste).
- **Drag & Drop**, Vorschau für PDF, Bilder und Text.
- **Backup** als JSON-Datei (inkl. aller Dateien) exportieren und wieder einspielen, z. B. um auf ein anderes Gerät umzuziehen.
- **Offline-fähig & installierbar** (PWA): „Zum Home-Bildschirm hinzufügen“.

## Daten

Alles wird lokal im Browser (IndexedDB) gespeichert. Es gibt keinen Server und keinen Account. **Regelmäßig Backups machen** (Tab „Backup“).

## Starten

Es gibt keinen Build-Schritt. Die Dateien müssen nur über einen Webserver ausgeliefert werden:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Oder über **GitHub Pages**: Repository → *Settings → Pages* → Branch auswählen → Ordner `/ (root)`.
