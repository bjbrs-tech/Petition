# Petitionsplattform

Unterschriften für Petitionen schnell per **QR-Code** sammeln: Teilnehmende scannen den
Code mit der Handykamera, landen direkt im Formular und geben nur **Name, Anschrift und
E-Mail-Adresse** ein. Alle Felder tragen die passenden `autocomplete`-Angaben – auf den
meisten Handys füllt die Autofill-Funktion das komplette Formular mit einem Tipp aus.

## Funktionen

- **Öffentlich**
  - Übersicht aller offenen Petitionen mit Fortschrittsbalken
  - Mobil optimiertes Unterschriftsformular (Name, Straße + Nr., PLZ, Ort, E-Mail, Einwilligung)
  - Doppelte Unterschriften (gleiche E-Mail pro Petition) werden nicht gezählt
  - Spamschutz per Honeypot-Feld und Rate-Limit (20 Absendungen/Minute pro IP)
- **Verwaltung** (`/admin`, Passwortschutz per HTTP Basic Auth)
  - Petitionen anlegen (Titel, Empfänger, Zielzahl, Text), schließen, wieder öffnen, löschen
  - QR-Code je Petition, Download als PNG/SVG
  - Druckfertiger **Aushang** mit großem QR-Code für Infostände und Plakate
  - Liste aller Unterschriften, einzelne Einträge löschen
  - **CSV-Export** (Excel-kompatibel, `;`-getrennt, UTF-8)

## Starten

Voraussetzung: Node.js ≥ 22.13 (nutzt das eingebaute `node:sqlite`, kein Datenbankserver nötig).

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
**„Sitzmöglichkeiten auf dem Schulhof der Werner-von-Siemens-Realschule“** angelegt –
erreichbar unter `/p/sitzplaetze-schulhof`. Titel, Empfänger, Zielzahl (300) und Text stehen in
[`seed/petitionen.json`](seed/petitionen.json) und können dort vor dem ersten Start angepasst
werden (danach in der Datenbank; eine gelöschte Petition wird nicht neu angelegt).
Eine andere Datei lässt sich per `SEED_FILE` angeben.

## Ablauf

1. In `/admin` eine Petition anlegen (oder die vorbereitete verwenden).
2. „Aushang drucken“ oder den QR-Code als PNG herunterladen und auf Flyer/Plakate setzen.
3. Teilnehmende scannen → Formular ausfüllen → „Unterschreiben“.
4. Unterschriften in der Verwaltung einsehen und als CSV exportieren.

## Datenschutz-Hinweise

Es werden personenbezogene Daten verarbeitet. Vor dem Einsatz bitte

- die Seite nur per **HTTPS** betreiben,
- ein **Impressum** und eine **Datenschutzerklärung** ergänzen (Verantwortlicher, Zweck,
  Speicherdauer, Weitergabe an den Petitionsempfänger, Betroffenenrechte),
- die Daten nach Abschluss der Petition löschen („Petition löschen“ entfernt alle Unterschriften).

## Tests

```bash
npm test
```
