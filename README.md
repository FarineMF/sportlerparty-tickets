# Sportlerparty Tickets

QR-Tickets und Einlass-Scanner für die Sportlerparty von UNI:Sport Kassel.
Verkauft wird über das Kursbuchungssystem. Die App macht aus der Teilnehmerliste PDF-Tickets zum Verschicken und prüft am Einlass.
Läuft auf Netlify (Functions + Blobs), genau wie die UNIfit Kasse.

## Ablauf

1. Party als Angebot im Buchungssystem anlegen und verkaufen.
2. Teilnehmerliste als **Excel oder CSV mit E-Mail-Spalte** exportieren.
3. In der App unter **Import** hochladen, Spalten prüfen, ggf. nach Zahlungsstatus filtern.
   Wer schon importiert wurde, wird übersprungen – einfach immer die komplette Liste hochladen.
4. Unter **Tickets** → **Nur neue Tickets (ZIP)**. Darin: ein PDF pro Person (`tickets/Nachname_Vorname.pdf`)
   und `uebersicht.csv` mit Name, E-Mail und Dateiname → über das eigene Postfach verschicken – oder automatisch per Mail (siehe unten).
5. Partyabend: auf jedem Einlass-Handy die Adresse öffnen → **Einlass** → Gerätename + PIN → Scanner starten.
6. Nach der Party ggf. **Liste als CSV** sichern und unter **Einstellungen** alle Teilnehmerdaten löschen.

## Einrichtung auf Netlify (einmalig)

1. Netlify → **Add new site → Import an existing project → GitHub** → Repo `sportlerparty-tickets` wählen.
   Build-Einstellungen kommen automatisch aus `netlify.toml`.
2. **Site configuration → Environment variables** anlegen:
   - `TICKETS_ADMIN_PASSWORT` – Passwort für die Verwaltung (lang!)
   - `TICKETS_SCAN_PIN` – PIN für die Einlass-Handys
3. Neu deployen (Deploys → Trigger deploy). Fertig.

### Optional: automatischer Mailversand über Gmail

1. Neues Gmail-Konto anlegen und **Bestätigung in zwei Schritten** aktivieren (Google-Konto → Sicherheit).
2. Unter **myaccount.google.com/apppasswords** ein App-Passwort erstellen (Name z. B. „Sportlerparty“) – 16 Zeichen.
3. In Netlify zwei weitere Variablen anlegen und neu deployen:
   - `TICKETS_MAIL_ADRESSE` – die Gmail-Adresse
   - `TICKETS_MAIL_PASSWORT` – das App-Passwort (nicht das normale Gmail-Passwort)
   - optional `TICKETS_MAIL_NAME` – Absendername (Standard „UNI:Sport Kassel“)
4. In der App unter **Tickets** erst eine Testmail an dich schicken, dann „Alle noch nicht gemailten senden“.
   Das Fenster muss während des Versands offen bleiben (ca. 1–2 Sekunden pro Mail). Gmail erlaubt rund 500 Mails pro Tag.

Vorschau-Deploys (Branch/Deploy-Preview) nutzen einen eigenen, leeren Speicher – Tests berühren nie die echten Daten.

## Aufbau

- `public/` – Oberfläche (Login, Verwaltung, Scanner)
- `netlify/functions/api.mjs` – Server: Anmeldung, Import, Einlass (jedes Ticket nur einmal), Export
- `netlify/mail.mjs` – Mailversand (Gmail/SMTP); das PDF erzeugt der Browser, der Server verschickt es nur an die gespeicherte Adresse
- `src/tickets.js` – Ticket-PDF + ZIP, läuft im Browser; wird zu `public/vendor/tickets.bundle.js` gebaut (`npm run build`, macht Netlify automatisch)
- `scripts/dev-server.mjs` – lokaler Test ohne Netlify:
  `TICKETS_ADMIN_PASSWORT=test TICKETS_SCAN_PIN=1234 npm run dev`

## Anpassen

- **Partyinfos:** in der App unter Einstellungen
- **Logo:** in der App unter Einstellungen als PNG hochladen
- **Schrift:** `public/fonts/UniversLTPro-65Bold.ttf` und `public/fonts/UniversLTPro-55Roman.ttf` ablegen – wird automatisch verwendet, sonst Inter.

## Datenschutz

Gespeichert werden Name, E-Mail, Kategorie und Einlasszeit (Netlify Blobs). Ticket-Codes sind zufällig und nur einmal gültig.
Verwaltung nur mit Passwort, Scanner nur mit PIN. Daten nach der Party in der App löschen.
