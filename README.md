# Petitionsplattform

Unterschriften für Petitionen schnell per **QR-Code** sammeln: Teilnehmende scannen den
Code mit der Handykamera, landen direkt im Formular und geben nur **Name, Anschrift und
E-Mail-Adresse** ein. Alle Felder tragen die passenden `autocomplete`-Angaben – auf den
meisten Handys füllt die Autofill-Funktion das komplette Formular mit einem Tipp aus.

## Funktionen

- **Öffentlich**
  - Übersicht aller offenen Petitionen mit Fortschrittsbalken
  - Mobil optimiertes Unterschriftsformular (Name, Straße + Nr., PLZ, Ort, E-Mail, Einwilligung);
    der Ort ist mit dem Ort der Petition vorbelegt, das Handy füllt den Rest per Autofill
  - **Altersabfrage** mit zwei Tasten („18 oder älter“ / „Unter 18“): Auch Kinder und Jugendliche
    können unterschreiben; bei „Unter 18“ erscheint zusätzlich die Bestätigung, dass die Eltern bzw.
    Erziehungsberechtigten einverstanden sind
  - Nach dem Unterschreiben: „Weitere Person unterschreiben lassen“ – praktisch am Infostand
  - Doppelte Unterschriften (gleiche E-Mail pro Petition) werden nicht gezählt
  - Spamschutz per Honeypot-Feld und Rate-Limit (20 Absendungen/Minute pro IP)
- **Verwaltung** (`/admin`, Passwortschutz per HTTP Basic Auth)
  - Petitionen anlegen (Titel, Empfänger, Zielzahl, Text), schließen, wieder öffnen, löschen
  - QR-Code je Petition, Download als PNG/SVG
  - Druckfertiger **Aushang** mit großem QR-Code für Infostände und Plakate
  - Liste aller Unterschriften, einzelne Einträge löschen
  - **CSV-Export** (Excel-kompatibel, `;`-getrennt, UTF-8)
  - Petition nachträglich bearbeiten (Text, Empfänger, Anschrift, Absender, Ziel) – der Link
    und damit der QR-Code bleiben gleich
- **Übergabe-Dokumente** (PDF, werden bei jedem Abruf aus dem aktuellen Stand erzeugt)
  - **Zusammenfassung:** Empfänger-Anschrift, Absender, Datum, Kennzahlen (Anzahl,
    davon unter 18, davon aus dem Ort der Petition, Sammelzeitraum), Petitionstext, Auswertung
    nach Altersgruppe, Wohnort und Postleitzahl
  - **Detaillierte Unterschriftenliste:** nummeriert mit Name, Anschrift, Alter und Datum;
    Minderjährige sind in der Spalte „Alter“ mit **„u18“** gekennzeichnet und farbig hinterlegt;
    lange Namen werden umbrochen statt abgeschnitten; Kopfzeile
    auf jeder Seite, Seitenzahlen, Bestätigungsfeld mit Unterschriftszeile –
    **ohne E-Mail-Adressen**
  - Beides auch zusammen als ein Übergabe-Dokument

## Starten

Voraussetzung: Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`, kein Datenbankserver nötig).
Die PDFs verwenden die mitgelieferte Schrift Liberation Sans (SIL Open Font License, siehe `fonts/`),
damit auch Namen wie „Şahin“ oder „Łukasz“ korrekt gedruckt werden.

```bash
npm install
ADMIN_PASSWORD=ein-sicheres-passwort npm start
```

- Öffentliche Seite: http://localhost:3000
- Verwaltung: http://localhost:3000/admin (Benutzer `admin`)

### Konfiguration (Umgebungsvariablen)

| Variable         | Bedeutung                                                                       | Standard                  |
|------------------|---------------------------------------------------------------------------------|---------------------------|
| `ADMIN_PASSWORD` | Passwort für `/admin` (**Pflicht**)                                             | –                         |
| `ADMIN_USER`     | Benutzername für `/admin`                                                       | `admin`                   |
| `PUBLIC_URL`     | Öffentliche Adresse, die im QR-Code steht, z. B. `https://petition.example.de`  | aus der Anfrage ermittelt |
| `PORT`           | HTTP-Port                                                                       | `3000`                    |
| `DATABASE_FILE`  | Pfad zur SQLite-Datei                                                           | `data/petition.sqlite`    |
| `TRUST_PROXY`    | `1`, wenn die App hinter einem Reverse-Proxy (nginx, Caddy …) läuft             | aus                       |

> **Wichtig:** Setzen Sie im Echtbetrieb `PUBLIC_URL` auf die HTTPS-Adresse, unter der die
> Seite erreichbar ist – sonst enthält der QR-Code ggf. `localhost` oder eine interne Adresse.

### Docker

```bash
docker build -t petition .
docker run -p 3000:3000 -v petition-data:/data \
  -e ADMIN_PASSWORD=ein-sicheres-passwort \
  -e PUBLIC_URL=https://petition.example.de \
  petition
```

## Vorbereitete Petition

Beim allerersten Start wird automatisch die Petition
**„Mehr Sitzmöglichkeiten auf dem Schulhof der Werner-von-Siemens-Realschule“** angelegt –
erreichbar unter `/p/sitzplaetze-schulhof`, adressiert an den Oberbürgermeister der
Landeshauptstadt Düsseldorf (Rathaus, Marktplatz 2, 40213 Düsseldorf). Titel, Empfänger,
Anschrift, Zielzahl (300) und Text stehen in
[`seed/petitionen.json`](seed/petitionen.json) und können dort vor dem ersten Start angepasst
werden; danach jederzeit in der Verwaltung unter „Petition bearbeiten“. Eine gelöschte
Petition wird nicht neu angelegt. Bitte dort auch **„Eingereicht von“** ausfüllen (z. B. die SMV) –
das erscheint als Absender und an der Unterschriftszeile.
Eine andere Datei lässt sich per `SEED_FILE` angeben.

## Ablauf

1. In `/admin` eine Petition anlegen (oder die vorbereitete verwenden).
2. „Aushang drucken“ oder den QR-Code als PNG herunterladen und auf Flyer/Plakate setzen.
3. Teilnehmende scannen → Formular ausfüllen → „Unterschreiben“.
4. Unterschriften in der Verwaltung einsehen und als CSV exportieren.
5. Zur Übergabe das **Übergabe-Dokument (PDF)** herunterladen, ausdrucken und unterschreiben.

## Datenschutz-Hinweise

Es werden personenbezogene Daten verarbeitet. Vor dem Einsatz bitte

- die Seite nur per **HTTPS** betreiben,
- ein **Impressum** und eine **Datenschutzerklärung** ergänzen (Verantwortlicher, Zweck,
  Speicherdauer, Weitergabe an den Petitionsempfänger, Betroffenenrechte),
- bei Minderjährigen beachten: Unter 16 Jahren ist für die Einwilligung die Zustimmung der
  Eltern nötig (Art. 8 DSGVO); das Formular fragt sie für alle unter 18 ab,
- die Daten nach Abschluss der Petition löschen („Petition löschen“ entfernt alle Unterschriften).

## Tests

```bash
npm test
```
