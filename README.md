# 🎚 Rider-Ablage

Interaktive Ablage für Techrider, Inputlisten, Stageplots & Co. – für Tontechniker:innen, die Bands und ganze Konzerte mischen. Mit Cloud-Sync für alle Geräte.

## Funktionen

### Rider einfach reinziehen
Datei(en) irgendwo auf die Seite ziehen oder oben auf **＋ Rider** tippen. Die App liest den Inhalt (PDF, Word, Excel, Text) und entscheidet selbst:

| Situation | Was passiert |
|---|---|
| **Bekannte Band, identische Datei** | „Ist aktuell“ – nichts wird neu gespeichert, nur als bestätigt markiert |
| **Bekannte Band, gleicher Inhalt** (nur neu exportiert, anderer Dateiname) | ebenfalls „aktuell“, kein neues Speichern |
| **Bekannte Band, Inhalt geändert** | neue Version wird gespeichert, alte archiviert. Die Änderungen werden angezeigt (+/− Zeilen). In allen anstehenden Konzerten wird automatisch die neue Version eingesetzt |
| **Alte, schon archivierte Version** | wird erkannt und ignoriert |
| **Neue Band** | Abfrage: Name (Vorschlag aus Dateiname/Inhalt), Genre, Kontakt (E-Mail/Telefon werden aus dem Rider gelesen) und zu welchem Konzert sie gehört – auch direkt ein neues Konzert anlegen |

Erkannt wird die Band über den Dateinamen, den Text im Rider und die Ähnlichkeit zu vorhandenen Ridern. Die Art (Techrider, Inputliste, Stageplot, Hospitality …) und das Datum („Stand: …“) werden ebenfalls erkannt. Vor dem Speichern zeigt ein Prüfdialog alles an, jede Entscheidung lässt sich ändern. Bei mehreren Dateien kann man alle auf einmal einem Konzert zuordnen.

Wird eine Datei auf die Karte einer Band im Konzert gezogen, ist Band und Konzert schon festgelegt.

### Bandseite: Mix-Infos, Inputliste & Patch
- **Überblick „Für den Mix“:** Die App liest alle aktuellen Rider der Band und fasst zusammen, was für den Mix wichtig ist: In-Ear ja/nein (eigenes Rack/Split?), Wedges & Monitorwege, eigenes Pult/Techniker:in/Mikros, Click & Playback, Funkstrecken, besondere Instrumente (Keys, Bläser, Streicher, Akustik), Anzahl Inputs/DIs/+48V, Drumriser, Strom, Effekte, Soundcheck-Zeiten und „wichtige Hinweise“ – jeweils mit dem Originalsatz aus dem Rider.
- **Inputliste:** wird aus dem Rider gelesen (Kanal laut Band-Rack/Split, Quelle, Mikro/DI, Stativ, 48V, Notiz). Lässt sich bearbeiten oder per „Liste einfügen“ aus E-Mail/Excel übernehmen. Kommt ein neuer Rider, schlägt die App das Neu-Einlesen vor.
- **Patch:** Stagebox-Profil wählen → die App legt jeden Band-Kanal auf den passenden Kanal deiner Stagebox (✓ passend, ≈ ähnlich, ＋ auf freien Kanal, Stereo-Paare bleiben nebeneinander). Jede Zeile lässt sich von Hand umlegen (wird pro Band und Profil gespeichert). Export: Kopieren (für Excel/Mail), CSV, Drucken/PDF.

### Stagebox-Profile
Eigener Bereich „Stagebox“: Profile anlegen, auf welchem Kanal du was haben willst – aus der Standard-Vorlage (32 Kanäle), leer, aus der Inputliste einer Band oder per eingefügter Liste. Pro Konzert lässt sich festlegen, welche Stagebox dort genutzt wird; der „🎛 Patch“-Knopf bei jeder Band nutzt dann dieses Profil.

### Konzerte & Bands
- Konzerte mit Datum, Ort, Notizen und Line-up (Reihenfolge, Spielzeiten).
- Wird eine bekannte Band zu einem Konzert hinzugefügt, fragt die App, ob die vorhandenen Rider noch aktuell sind, und ordnet sie direkt zu.
- Bands-Suche und **Volltextsuche** – auch im Text der Rider (z. B. „sm58“, „Flügel“).
- Hinweise auf Rider, die seit über 12 Monaten nicht bestätigt wurden, und auf Bands ohne Rider.

### Cloud & Offline
- Sync über **Supabase** (kostenlos): Daten und Dateien sind auf Handy, Laptop und Tablet gleich.
- Die App arbeitet immer mit einer lokalen Kopie – funktioniert also auch ohne Netz in der Venue. Änderungen werden übertragen, sobald wieder Verbindung besteht.
- Zusätzlich Backup als Datei (inkl. aller Rider).
- Installierbar als App („Zum Home-Bildschirm hinzufügen“).

## Cloud einrichten (einmalig, ca. 5 Minuten)

1. Auf [supabase.com](https://supabase.com) kostenlos registrieren und ein **neues Projekt** anlegen.
2. Im Projekt **SQL Editor** öffnen, den Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen und **Run** klicken.
3. Unter **Project Settings → API** die **Project URL** und den **anon / publishable key** kopieren.
4. In der App auf **Cloud** gehen, beides eintragen, **Verbinden** und **Neues Konto anlegen**.
5. Weitere Geräte: In der App „Link für weiteres Gerät“ öffnen und dort anmelden.
   Alternativ URL und Key in [`config.js`](config.js) eintragen, dann ist jedes Gerät automatisch verbunden.

**Tipps**
- Wenn Supabase eine Bestätigungs-Mail schickt: Link anklicken, dann in der App anmelden.
- Nachdem dein Konto angelegt ist, unter *Authentication → Sign In / Providers* „Allow new users to sign up“ ausschalten. Dann kann niemand sonst dein Projekt nutzen (die Daten sind ohnehin pro Konto geschützt).
- Der anon-Key ist dafür gedacht, öffentlich zu sein. Geschützt wird über Login und Row Level Security.

## Starten

Kein Build-Schritt nötig – die Dateien müssen nur über einen Webserver ausgeliefert werden:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

Oder über **GitHub Pages**: Repository → *Settings → Pages* → Branch auswählen → Ordner `/ (root)`.

## Technik
- Reines HTML/CSS/JavaScript, keine Abhängigkeiten außer [pdf.js](https://mozilla.github.io/pdf.js/) (liegt in `vendor/`, Apache-2.0) zum Auslesen von PDFs.
- `db.js` – lokale Datenbank (IndexedDB) · `cloud.js` – Supabase-Sync · `smart.js` – Erkennung & Import · `patch.js` – Inputliste, Mix-Infos & Patch-Logik · `patch-ui.js` – Patch & Stagebox-Oberfläche · `app.js` – Oberfläche.
