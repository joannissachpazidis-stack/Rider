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

- **Direkt in der Patch-Tabelle ändern:** 48V per Klick, Mikro, Stativ und Notiz – wird in der Inputliste der Band gespeichert.
- **Patchliste drucken:** immer Kanal, Stagebox-Kanal und Übergabe-Kanal der Band, wahlweise zusätzlich 48V, Mikro, Stativ, Notiz. Mit Konzert und Spielzeit im Kopf, wenn du über das Konzert kommst.
- **Mix-Infos korrigieren:** jede Info lässt sich überschreiben oder ausblenden, eigene Infos und „Meine Notizen zum Mix“ ergänzen.

### Stagebox-Profile
Eigener Bereich „Stagebox“: Profile anlegen, auf welchem Kanal du was haben willst – aus der Standard-Vorlage (32 Kanäle), leer, aus der Inputliste einer Band oder per eingefügter Liste. Pro Konzert lässt sich festlegen, welche Stagebox dort genutzt wird; der „🎛 Patch“-Knopf bei jeder Band nutzt dann dieses Profil.

### Konzerte
- Anstehende Konzerte nach Datum und Uhrzeit (das nächste oben, mit „Heute“, „Morgen“, „in 5 Tagen“), Konzerte ohne Datum separat, vergangene eingeklappt. Vergangene Konzerte bleiben mit den damals gültigen Ridern erhalten.
- **Tagesablauf:** Get-in, Aufbau, Line-Check, Soundchecks, Catering, Einlass, Shows, Umbauten, Curfew, Abbau und eigene Einträge – mit Band und Notiz. „Ablauf erstellen“ macht einen Vorschlag aus dem Line-up (Soundchecks in umgekehrter Reihenfolge, Soundcheck- und Umbauzeiten aus den Ridern). Bei Verzug „Verschieben“ (alles ab einem Eintrag um X Minuten, Curfew bleibt fest), am Konzerttag ist der aktuelle Punkt markiert, Überschneidungen werden angezeigt. Drucken oder als Text kopieren (z. B. für WhatsApp). Showzeiten und Spielzeiten im Line-up bleiben synchron.
- **Alle Patchlisten drucken:** eine Seite pro Band, mit Spielzeit – der Tagesablauf kommt als erste Seite dazu.
- **Material-Bedarf:** wie viele Mikros (nach Modell), DIs, Stative, Funkstrecken und 48V-Kanäle die größte Band braucht.

### Festivals
- „🎪 + Festival“: Name, Ort, erster Tag, Anzahl Tage und optional Bühnen (dann ein Bereich pro Tag und Bühne).
- In der Konzertliste eine Karte mit Zeitraum, Anzahl Tagen und allen Bands.
- Beim Öffnen: **Übersicht** (Stagebox fürs ganze Festival, alle Tage, alle Bands mit Tag und Spielzeit) und ein **Bereich pro Tag** mit eigenem Line-up, Tagesablauf, Material und Patchlisten – am Festivaltag öffnet sich direkt der heutige Tag.
- **Drucken pro Tag** (Ablauf + Patchlisten dieses Tages), nur den Ablauf eines Tages, das **ganze Festival** oder **alle Abläufe**.
- Tage/Bühnen lassen sich hinzufügen, umbenennen, verschieben und löschen. Rider-Import und Bandseiten zeigen die Tage als „Festival – Tag 2“.

### Bands ohne Tag & Running Order
- **Festivals:** Bands können zuerst nur dem Festival hinzugefügt werden („Bands ohne Tag“) – auch schon beim Anlegen. Später „Einteilen in …“ einen Tag/eine Bühne; im Tag lassen sie sich per „↔ Verschieben“ auf einen anderen Tag, eine andere Bühne oder zurück zu „ohne Tag“ legen. Rider können schon vorher abgelegt werden.
- **Tage & Bühnen:** gezählt und angezeigt als „3 Tage · 2 Bühnen“; ein Tab pro Tag, darin Umschalter für die Bühnen. „＋ Bühne“ fügt eine Bühne an einem oder allen Tagen hinzu; „Tag drucken“ druckt alle Bühnen des Tages, „nur Hauptbühne“ einzeln.
- **Reihenfolge (alle Konzerte):** Neue Bands landen unter „Reihenfolge offen“. „↥ Einreihen“ setzt sie in die Running Order (oder automatisch, sobald eine Spielzeit eingetragen wird), ↑↓ ändert die Reihenfolge, „↧“ macht sie wieder offen. Der Ablauf-Vorschlag hängt Bands ohne Reihenfolge hinten an.

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
- `db.js` – lokale Datenbank (IndexedDB) · `cloud.js` – Supabase-Sync · `smart.js` – Erkennung & Import · `patch.js` – Inputliste, Mix-Infos & Patch-Logik · `patch-ui.js` – Patch & Stagebox-Oberfläche · `schedule.js` – Tagesablauf · `festival.js` – Festivals · `app.js` – Oberfläche.
