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
  { name: 'name', label: 'Vor- und Nachname', autocomplete: 'name', type: 'text', max: 120 },
  { name: 'street', label: 'Straße und Hausnummer', autocomplete: 'street-address', type: 'text', max: 160 },
  { name: 'postal_code', label: 'PLZ', autocomplete: 'postal-code', type: 'text', max: 10, inputmode: 'numeric', short: true },
  { name: 'city', label: 'Ort', autocomplete: 'address-level2', type: 'text', max: 100 },
  { name: 'email', label: 'E-Mail-Adresse', autocomplete: 'email', type: 'email', max: 254, inputmode: 'email' },
];

function field(f, values, errors) {
  const err = errors[f.name];
  return `<div class="field${f.short ? ' short' : ''}">
        <label for="${f.name}">${f.label}</label>
        <input id="${f.name}" name="${f.name}" type="${f.type}" required maxlength="${f.max}"
          autocomplete="${f.autocomplete}"${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}
          ${f.type === 'text' && f.name !== 'postal_code' ? 'autocapitalize="words"' : ''}
          value="${esc(values[f.name])}"${err ? ' aria-invalid="true"' : ''}>
        ${err ? `<p class="error">${esc(err)}</p>` : ''}
      </div>`;
}

function petition(p, { values = {}, errors = {} } = {}) {
  const form = p.is_open
    ? `<form method="post" action="/p/${esc(p.slug)}" class="sign-form" novalidate>
      <h2>Jetzt unterschreiben</h2>
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
      <label class="consent${errors.consent ? ' invalid' : ''}">
        <input type="checkbox" name="consent" value="1" required${values.consent ? ' checked' : ''}>
        <span>Ich unterstütze diese Petition und bin einverstanden, dass meine Angaben
        zu diesem Zweck gespeichert und ${p.recipient ? `an ${esc(p.recipient)}` : 'an die Empfänger der Petition'}
        übergeben werden.</span>
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
      ${progress(p)}
      ${form}
      ${p.description ? `<section class="description">${nl2p(p.description)}</section>` : ''}
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
      <p><a class="btn" href="/p/${esc(p.slug)}">Zur Petition</a></p>
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
        <div class="field">
          <label for="title">Titel</label>
          <input id="title" name="title" required maxlength="200" value="${esc(values.title)}">
          ${errors.title ? `<p class="error">${esc(errors.title)}</p>` : ''}
        </div>
        <div class="field">
          <label for="recipient">Empfänger (optional)</label>
          <input id="recipient" name="recipient" maxlength="200" value="${esc(values.recipient)}"
            placeholder="z.&nbsp;B. Gemeinderat Musterstadt">
        </div>
        <div class="field">
          <label for="goal">Ziel – Anzahl Unterschriften (optional)</label>
          <input id="goal" name="goal" type="number" min="0" max="10000000" value="${esc(values.goal)}">
        </div>
        <div class="field">
          <label for="description">Beschreibung / Petitionstext</label>
          <textarea id="description" name="description" rows="8" maxlength="20000">${esc(values.description)}</textarea>
        </div>
        <button class="btn primary" type="submit">Petition anlegen</button>
      </form>
    </section>`,
  });
}

function adminPetition(p, signatures, publicUrl, qrSvg) {
  const rows = signatures.map((s) => `
        <tr>
          <td>${esc(s.created_at)}</td>
          <td>${esc(s.name)}</td>
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
        <thead><tr><th>Datum (UTC)</th><th>Name</th><th>Anschrift</th><th>E-Mail</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>` : '<p class="muted">Noch keine Unterschriften.</p>'}
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
