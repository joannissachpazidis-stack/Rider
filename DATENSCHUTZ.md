# Datenschutz & Sicherheit – Rider-Ablage

Diese Übersicht beschreibt, welche Daten die App verarbeitet, wo sie liegen, wer sie sehen kann und welche Schutzmaßnahmen eingebaut sind. Sie ist als Grundlage für die Abstimmung mit dem Träger bzw. der/dem Datenschutzbeauftragten gedacht (z. B. für das Verzeichnis von Verarbeitungstätigkeiten). **Sie ersetzt keine Rechtsberatung.**

## Welche Daten?

- **Bands:** Name, Genre, Kontakt (oft Name, Telefon, E-Mail einer Ansprechperson), Notizen, Mix-Notizen.
- **Rider/Unterlagen:** Techrider, Inputlisten, Stageplots, Hospitality-Rider usw. als Dateien plus ausgelesener Text. Diese können personenbezogene Daten enthalten – bei Jugendbands auch von **Minderjährigen**, in Hospitality-Ridern teils **Gesundheitsangaben** (Allergien, Ernährung = besondere Kategorie nach Art. 9 DSGVO).
- **Konzerte/Festivals:** Datum, Ort, Line-up, Tagesablauf, Notizen.
- **Team:** E-Mail-Adressen der Mitarbeitenden, Rolle (Admin/Verwaltung/Mitglied).

## Wo liegen die Daten?

| Ort | Was | Hinweis |
|---|---|---|
| **Supabase** (Datenbank + Dateispeicher) | alle Daten und Dateien | Region bei Projektanlage wählen (EU, z. B. Frankfurt). Auftragsverarbeitungsvertrag (DPA) bei Supabase abschließen. |
| **Netlify** (Webseite) | nur der Programmcode der App, **keine** Inhalte | Netlify sieht technisch Zugriffe (IP-Adressen) auf die Webseite. DPA bei Netlify verfügbar. |
| **Geräte der Mitarbeitenden** | Arbeitskopie im Browser (für Offline-Betrieb) | Nur auf eigenen bzw. gesperrten Geräten nutzen; auf gemeinsamen Geräten beim Abmelden „Daten löschen“ (vorausgewählt). |

Die App lädt keine Schriften, Skripte oder Tracker von Drittanbietern und sendet keine Daten an KI- oder Analysedienste.

## Wer sieht was?

- Nur **eingetragene Team-Mitglieder** sehen überhaupt etwas – ein Konto allein reicht nicht.
- **Bands, Rider, Stagebox-Profile:** alle im Team.
- **Konzerte/Festivals:** nur wer sie angelegt hat und mit wem sie geteilt sind („Nur ich“, „Ganzes Team“, ausgewählte Personen).
- **Team verwalten:** nur Admin und freigeschaltete Personen; Rechte vergibt nur der Admin.
- Diese Regeln setzt die **Datenbank selbst** durch (Row Level Security), nicht nur die Oberfläche.

## Eingebaute Schutzmaßnahmen (technisch)

- Verschlüsselte Verbindungen (HTTPS) zu Netlify und Supabase; Passwörter speichert Supabase nur als Hash.
- Zugriffsregeln in der Datenbank (Team-Mitgliedschaft, Rollen, Freigaben pro Konzert), getestet gegen eine echte PostgreSQL-Datenbank.
- Privater Dateispeicher; Dateien nur für Team-Mitglieder abrufbar.
- **Content Security Policy** und weitere Sicherheits-Header (`netlify.toml`): Der Browser führt nur Code der App selbst aus und verbindet sich nur mit Supabase. Eingeschleuster Code – z. B. aus einem präparierten Rider – wird blockiert.
- Alle Texte aus Ridern, Dateinamen und Eingaben werden vor der Anzeige maskiert; technische Felder aus Cloud und Backups werden zusätzlich gefiltert.
- Rider werden nur geöffnet, wenn sie nachweislich PDF, Bild oder Text sind (Erkennung am Dateiinhalt). Andere Dateien (z. B. HTML/SVG) gibt es nur als Download.
- Einrichtungs-Links können die App nicht unbemerkt auf einen fremden Server umleiten (nur echte Supabase-Adressen, Rückfrage + Abmelden bei Wechsel; mit fester Verbindung in `config.js` werden sie ganz ignoriert).
- Wer aus dem Team entfernt wird, verliert den Zugriff sofort; die Kopie auf seinen Geräten wird beim nächsten Öffnen gelöscht.
- Anmeldung mit einem anderen Konto auf demselben Gerät löscht die lokale Kopie des vorherigen Kontos.
- Exporte (CSV/Kopieren) entschärfen Excel-Formeln aus Rider-Texten.
- PDF-Auslesen mit aktueller pdf.js-Version (4.10) und abgeschalteter Code-Ausführung.

## Was organisatorisch zu tun ist (Checkliste)

- [ ] Mit Träger bzw. Datenschutzbeauftragter/m abstimmen (bei kirchlichen Trägern gelten KDG bzw. DSG-EKD statt DSGVO).
- [ ] Supabase: Region prüfen (EU), **DPA** abschließen, **Zwei-Faktor-Anmeldung** für das Supabase-Konto aktivieren.
- [ ] Netlify: DPA abschließen, Zwei-Faktor-Anmeldung aktivieren.
- [ ] Supabase → Authentication: „Confirm email“ **eingeschaltet lassen** (sonst könnte sich jemand mit der E-Mail eines Teammitglieds registrieren), Mindestlänge für Passwörter auf 10+ setzen, nach dem Onboarding „Allow new users to sign up“ ausschalten.
- [ ] Project URL und anon key in `config.js` eintragen (feste Verbindung, keine Einrichtungs-Links mehr nötig).
- [ ] Eintrag ins Verzeichnis von Verarbeitungstätigkeiten (Zweck: Organisation von Konzerten/Festival; Daten: s. o.; Empfänger: Supabase, Netlify als Auftragsverarbeiter).
- [ ] Bands informieren (Datenschutzhinweis z. B. im Anmeldeformular fürs Festival).
- [ ] Gesundheitsdaten (Allergien etc.) möglichst nicht in der App ablegen oder nur so viel wie nötig.
- [ ] Löschkonzept: Bands/Rider ohne Auftritte nach festgelegter Frist (z. B. 2 Jahre) löschen.
- [ ] Nur Mitarbeitende ins Team aufnehmen; Geräte mit Bildschirmsperre; auf gemeinsamen PCs immer abmelden.
- [ ] Vor dem Festival: Backup herunterladen und Patchlisten/Abläufe zusätzlich ausdrucken (Ausfallsicherheit).

## Bekannte Grenzen

- Alle Team-Mitglieder können Bands und Rider ändern und löschen; es gibt keinen Änderungsverlauf. Regelmäßige Backups helfen.
- Keine Zwei-Faktor-Anmeldung in der App selbst – starke, einzigartige Passwörter sind wichtig.
- Die lokale Arbeitskopie im Browser ist nicht zusätzlich verschlüsselt (Schutz über Gerätesperre).
- Kostenlose Supabase-Projekte werden nach längerer Nichtnutzung pausiert und bieten nach unserem Stand keine selbst wiederherstellbaren Backups – vor wichtigen Terminen prüfen bzw. Backup ziehen.
- Diese Prüfung ist ein sorgfältiger Code-Review mit Tests, aber kein zertifizierter Penetrationstest.
