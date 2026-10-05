const { formatDateTime, formatNumber, formatPercent } = require('./format');

const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);

const nl2p = (text) =>
  esc(text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');

function layout({ title, body, bodyClass = '' }) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body class="${esc(bodyClass)}">
  <main class="container">
${body}
  </main>
</body>
</html>`;
}

function progress(p) {
  if (!p.goal) return `<p class="count"><strong>${p.signature_count}</strong> Unterschriften</p>`;
  const pct = Math.min(100, Math.round((p.signature_count / p.goal) * 100));
  return `<div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
      <div class="progress-bar" style="width:${pct}%"></div>
    </div>
    <p class="count"><strong>${p.signature_count}</strong> von ${p.goal} Unterschriften</p>`;
}

function home(petitions) {
  const items = petitions.length
    ? petitions.map((p) => `
      <li class="card">
        <h2><a href="/p/${esc(p.slug)}">${esc(p.title)}</a></h2>
        ${progress(p)}
      </li>`).join('')
    : '<p class="muted">Aktuell gibt es keine offenen Petitionen.</p>';
  return layout({
    title: 'Petitionen',
    body: `<h1>Petitionen</h1><ul class="list">${items}</ul>`,
  });
}

const FIELDS = [
  { name: 'name', label: 'Vor- und Nachname', autocomplete: 'name', type: 'text', max: 120, enter: 'next' },
  { name: 'street', label: 'Straße und Hausnummer', autocomplete: 'address-line1', type: 'text', max: 160, enter: 'next' },
  { name: 'postal_code', label: 'PLZ', autocomplete: 'postal-code', type: 'text', max: 10, inputmode: 'numeric', short: true, enter: 'next' },
  { name: 'city', label: 'Ort', autocomplete: 'address-level2', type: 'text', max: 100, enter: 'next' },
  { name: 'email', label: 'E-Mail-Adresse', autocomplete: 'email', type: 'email', max: 254, inputmode: 'email', enter: 'done' },
];

function field(f, values, errors) {
  const err = errors[f.name];
  return `<div class="field${f.short ? ' short' : ''}">
        <label for="${f.name}">${f.label}</label>
        <input id="${f.name}" name="${f.name}" type="${f.type}" required maxlength="${f.max}"
          autocomplete="${f.autocomplete}" enterkeyhint="${f.enter}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}
          ${f.type === 'text' && f.name !== 'postal_code' ? 'autocapitalize="words"' : 'autocapitalize="off" spellcheck="false"'}
          value="${esc(values[f.name])}"${err ? ' aria-invalid="true"' : ''}>
        ${err ? `<p class="error">${esc(err)}</p>` : ''}
      </div>`;
}

function petition(p, { values: given = {}, errors = {} } = {}) {
  // Ort ist mit dem Ort der Petition vorbelegt – die meisten Unterzeichnenden wohnen dort.
  const values = { ...given, city: given.city ?? p.default_city };
  const form = p.is_open
    ? `<form method="post" action="/p/${esc(p.slug)}" class="sign-form" id="unterschreiben" novalidate>
      <h2>Jetzt unterschreiben</h2>
      ${Object.keys(errors).length ? '' : `<p class="hint">Tipp: Ins erste Feld tippen – Ihr Handy schlägt Name,
        Adresse und E-Mail meist automatisch vor.</p>`}
      ${errors._form ? `<p class="error banner">${esc(errors._form)}</p>` : ''}
      <div class="row">
      ${FIELDS.slice(0, 2).map((f) => field(f, values, errors)).join('')}
      </div>
      <div class="row inline">
      ${FIELDS.slice(2, 4).map((f) => field(f, values, errors)).join('')}
      </div>
      ${field(FIELDS[4], values, errors)}
      <div class="hp" aria-hidden="true">
        <label for="website">Website</label>
        <input id="website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
      <fieldset class="age${errors.age ? ' invalid' : ''}">
        <legend>Alter</legend>
        <div class="segmented">
          <label><input type="radio" name="age" value="18+" required${values.age === '18+' ? ' checked' : ''}>
            <span>18 oder älter</span></label>
          <label><input type="radio" name="age" value="u18" id="age-u18"${values.age === 'u18' ? ' checked' : ''}>
            <span>Unter 18</span></label>
        </div>
        ${errors.age ? `<p class="error">${esc(errors.age)}</p>` : ''}
        <div class="minor-only">
          <label class="consent${errors.parental_consent ? ' invalid' : ''}">
            <input type="checkbox" name="parental_consent" value="1"${values.parental_consent ? ' checked' : ''}>
            <span>Meine Eltern bzw. Erziehungsberechtigten sind einverstanden, dass ich unterschreibe.
            Unterschriften von Minderjährigen werden in der Liste gekennzeichnet.</span>
          </label>
          ${errors.parental_consent ? `<p class="error">${esc(errors.parental_consent)}</p>` : ''}
        </div>
      </fieldset>
      <label class="consent${errors.consent ? ' invalid' : ''}">
        <input type="checkbox" name="consent" value="1" required${values.consent ? ' checked' : ''}>
        <span>Ich unterstütze diese Petition. Mein Name und meine Anschrift dürfen dafür gespeichert und
        ${p.recipient ? `an ${esc(p.recipient)}` : 'an die Empfänger der Petition'} übergeben werden.
        Meine E-Mail-Adresse wird nicht weitergegeben.</span>
      </label>
      ${errors.consent ? `<p class="error">${esc(errors.consent)}</p>` : ''}
      <button type="submit" class="btn primary big">Unterschreiben</button>
    </form>`
    : '<p class="banner closed">Diese Petition ist abgeschlossen. Vielen Dank für die Unterstützung!</p>';

  return layout({
    title: p.title,
    body: `<article class="petition">
      <h1>${esc(p.title)}</h1>
      ${p.recipient ? `<p class="muted">An: ${esc(p.recipient)}</p>` : ''}
      ${p.description && p.is_open ? '<p><a href="#worum-geht-es">Worum geht es? ↓</a></p>' : ''}
      ${progress(p)}
      ${form}
      ${p.description ? `<section class="description" id="worum-geht-es">
        <h2>Worum geht es?</h2>${nl2p(p.description)}</section>` : ''}
    </article>`,
  });
}

function thanks(p, { duplicate = false } = {}) {
  return layout({
    title: 'Vielen Dank!',
    body: `<div class="thanks">
      <div class="check" aria-hidden="true">✓</div>
      <h1>${duplicate ? 'Sie haben bereits unterschrieben' : 'Vielen Dank für Ihre Unterschrift!'}</h1>
      <p>${duplicate
        ? 'Mit dieser E-Mail-Adresse wurde diese Petition bereits unterzeichnet. Jede Stimme zählt einmal.'
        : `Ihre Unterschrift für „${esc(p.title)}“ wurde gespeichert.`}</p>
      ${progress(p)}
      ${p.is_open ? `<p><a class="btn primary big" href="/p/${esc(p.slug)}#unterschreiben">Weitere Person unterschreiben lassen</a></p>` : ''}
      <p><a href="/p/${esc(p.slug)}#worum-geht-es">Zur Petition</a></p>
    </div>`,
  });
}

function notFound() {
  return layout({
    title: 'Nicht gefunden',
    body: '<h1>Nicht gefunden</h1><p>Diese Seite gibt es nicht.</p><p><a href="/">Zur Startseite</a></p>',
  });
}

function adminIndex(petitions, { errors = {}, values = {} } = {}) {
  const rows = petitions.map((p) => `
      <tr>
        <td><a href="/admin/p/${p.id}">${esc(p.title)}</a></td>
        <td>${p.signature_count}${p.goal ? ` / ${p.goal}` : ''}</td>
        <td>${p.is_open ? '<span class="tag open">offen</span>' : '<span class="tag">geschlossen</span>'}</td>
      </tr>`).join('');
  return layout({
    title: 'Verwaltung',
    bodyClass: 'admin',
    body: `<h1>Verwaltung</h1>
    <section class="card">
      <h2>Petitionen</h2>
      ${petitions.length ? `<table>
        <thead><tr><th>Titel</th><th>Unterschriften</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>` : '<p class="muted">Noch keine Petitionen angelegt.</p>'}
    </section>
    <section class="card">
      <h2>Neue Petition</h2>
      <form method="post" action="/admin/petitions">
        ${petitionFields(values, errors)}
        <button class="btn primary" type="submit">Petition anlegen</button>
      </form>
    </section>`,
  });
}

function petitionFields(v, errors = {}) {
  const input = (name, label, extra = '', hint = '') => `<div class="field">
          <label for="${name}">${label}</label>
          <input id="${name}" name="${name}" maxlength="200" value="${esc(v[name])}" ${extra}>
          ${hint ? `<p class="muted small">${hint}</p>` : ''}
          ${errors[name] ? `<p class="error">${esc(errors[name])}</p>` : ''}
        </div>`;
  return `${input('title', 'Titel', 'required')}
        ${input('recipient', 'Empfänger', '', 'Erscheint im Formular und auf den Übergabe-Dokumenten.')}
        <div class="field">
          <label for="recipient_address">Anschrift des Empfängers</label>
          <textarea id="recipient_address" name="recipient_address" rows="3" maxlength="500">${esc(v.recipient_address)}</textarea>
        </div>
        ${input('initiator', 'Eingereicht von', '', 'z.&nbsp;B. Schülervertretung (SMV) der Schule – erscheint als Absender.')}
        ${input('default_city', 'Ort der Petition', '', 'Wird im Formular als Wohnort vorbelegt und in der Auswertung gezählt („davon aus …“).')}
        <div class="field">
          <label for="goal">Ziel – Anzahl Unterschriften</label>
          <input id="goal" name="goal" type="number" min="0" max="10000000" value="${esc(v.goal)}">
        </div>
        <div class="field">
          <label for="description">Petitionstext</label>
          <textarea id="description" name="description" rows="10" maxlength="20000">${esc(v.description)}</textarea>
        </div>`;
}

function statTiles(p, stats) {
  const tiles = [
    ['Unterschriften', formatNumber(stats.total)],
    ...(stats.fromHome !== null
      ? [[`davon aus ${stats.homeCity}`, `${formatNumber(stats.fromHome)} <small>(${formatPercent(stats.fromHome, stats.total)})</small>`]]
      : []),
    ['davon unter 18', `${formatNumber(stats.minors)} <small>(${formatPercent(stats.minors, stats.total)})</small>`],
    ['Sammelzeitraum', stats.total ? `${stats.first} – ${stats.last}` : '–'],
  ];
  return `<div class="tiles">${tiles.map(([label, value]) =>
    `<div class="tile"><span class="muted">${esc(label)}</span><strong>${value}</strong></div>`).join('')}</div>`;
}

function adminPetition(p, signatures, publicUrl, qrSvg, stats, { values, errors = {} } = {}) {
  const rows = signatures.map((s) => `
        <tr>
          <td>${esc(formatDateTime(s.created_at))}</td>
          <td>${esc(s.name)}${s.is_adult === 0 ? ' <span class="tag minor">unter 18</span>' : ''}</td>
          <td>${esc(s.street)}, ${esc(s.postal_code)} ${esc(s.city)}</td>
          <td>${esc(s.email)}</td>
          <td>
            <form method="post" action="/admin/p/${p.id}/signatures/${s.id}/delete"
              onsubmit="return confirm('Unterschrift wirklich löschen?')">
              <button class="btn small danger" type="submit">Löschen</button>
            </form>
          </td>
        </tr>`).join('');
  return layout({
    title: `${p.title} – Verwaltung`,
    bodyClass: 'admin',
    body: `<p><a href="/admin">← Alle Petitionen</a></p>
    <h1>${esc(p.title)}</h1>
    <section class="card qr-card">
      <div class="qr">${qrSvg}</div>
      <div>
        <h2>QR-Code zum Unterschreiben</h2>
        <p>Teilnehmende scannen den Code mit der Handykamera und landen direkt im Formular.
        Name, Anschrift und E-Mail füllt das Handy per Autofill meist mit einem Tipp aus.</p>
        <p><a href="${esc(publicUrl)}" target="_blank" rel="noopener">${esc(publicUrl)}</a></p>
        <p class="actions">
          <a class="btn primary" href="/admin/p/${p.id}/poster" target="_blank">Aushang drucken</a>
          <a class="btn" href="/admin/p/${p.id}/qr.png" download="qr-${esc(p.slug)}.png">QR als PNG</a>
          <a class="btn" href="/admin/p/${p.id}/qr.svg" download="qr-${esc(p.slug)}.svg">QR als SVG</a>
        </p>
      </div>
    </section>
    <section class="card">
      <h2>Übergabe${p.recipient ? ` an ${esc(p.recipient)}` : ''}</h2>
      ${statTiles(p, stats)}
      <p>Die Dokumente werden bei jedem Herunterladen automatisch aus dem aktuellen Stand erzeugt –
      Name und Anschrift aller Unterzeichnenden, ohne E-Mail-Adressen.</p>
      <div class="actions">
        <a class="btn primary" href="/admin/p/${p.id}/uebergabe.pdf">Übergabe-Dokument (komplett)</a>
        <a class="btn" href="/admin/p/${p.id}/zusammenfassung.pdf">Nur Zusammenfassung</a>
        <a class="btn" href="/admin/p/${p.id}/unterschriftenliste.pdf">Nur detaillierte Liste</a>
      </div>
    </section>
    <section class="card">
      <h2>Status</h2>
      ${progress(p)}
      <div class="actions">
        <form method="post" action="/admin/p/${p.id}/${p.is_open ? 'close' : 'open'}">
          <button class="btn" type="submit">${p.is_open ? 'Petition schließen' : 'Petition wieder öffnen'}</button>
        </form>
        <form method="post" action="/admin/p/${p.id}/delete"
          onsubmit="return confirm('Petition inklusive aller Unterschriften endgültig löschen?')">
          <button class="btn danger" type="submit">Petition löschen</button>
        </form>
      </div>
    </section>
    <section class="card">
      <h2>Unterschriften (${signatures.length})</h2>
      <p><a class="btn" href="/admin/p/${p.id}/export.csv">Als CSV exportieren</a></p>
      ${signatures.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Datum</th><th>Name</th><th>Anschrift</th><th>E-Mail</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<p class="muted">Noch keine Unterschriften.</p>'}
    </section>
    <section class="card">
      <details${Object.keys(errors).length ? ' open' : ''}>
        <summary><h2>Petition bearbeiten</h2></summary>
        <form method="post" action="/admin/p/${p.id}/edit">
        ${petitionFields(values || p, errors)}
        <button class="btn primary" type="submit">Speichern</button>
        </form>
      </details>
    </section>`,
  });
}

function poster(p, publicUrl, qrSvg) {
  return layout({
    title: `Aushang – ${p.title}`,
    bodyClass: 'poster',
    body: `<div class="poster-sheet">
      <h1>${esc(p.title)}</h1>
      ${p.recipient ? `<p class="muted">Petition an ${esc(p.recipient)}</p>` : ''}
      <p class="cta">Jetzt in 30 Sekunden unterschreiben!</p>
      <div class="qr big">${qrSvg}</div>
      <p class="howto">Handykamera öffnen → QR-Code scannen → Name, Anschrift &amp; E-Mail eintragen</p>
      <p class="url">${esc(publicUrl)}</p>
      <p class="no-print"><button class="btn primary" onclick="window.print()">Drucken</button></p>
    </div>`,
  });
}

module.exports = {
  esc, home, petition, thanks, notFound, adminIndex, adminPetition, poster, FIELDS,
};
