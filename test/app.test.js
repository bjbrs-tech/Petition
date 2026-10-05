const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase, slugify } = require('../src/db');
const { createApp } = require('../src/app');

const AUTH = `Basic ${Buffer.from('admin:secret').toString('base64')}`;

async function startServer() {
  const db = openDatabase(':memory:');
  const app = createApp({ db, adminPassword: 'secret' });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db,
    base,
    close: () => new Promise((r) => server.close(() => { db.close(); r(); })),
  };
}

const form = (obj) => new URLSearchParams(obj).toString();
const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
  body: form(body),
});

const validSignature = {
  name: 'Erika Mustermann',
  street: 'Hauptstraße 1',
  postal_code: '12345',
  city: 'Musterstadt',
  email: 'Erika@Example.org',
  consent: '1',
  age: '18+',
};

test('slugify handles umlauts', () => {
  assert.equal(slugify('Mehr Bäume für die Straße!'), 'mehr-baeume-fuer-die-strasse');
});

test('full flow: create petition, sign via QR link, export', async (t) => {
  const srv = await startServer();
  t.after(srv.close);

  // Admin requires auth
  assert.equal((await fetch(`${srv.base}/admin`)).status, 401);

  // Create petition
  let res = await post(`${srv.base}/admin/petitions`,
    { title: 'Mehr Bäume', recipient: 'Gemeinderat', goal: '100', description: 'Text' },
    { authorization: AUTH, origin: srv.base });
  assert.equal(res.status, 303);
  const adminPath = res.headers.get('location');
  assert.match(adminPath, /^\/admin\/p\/\d+$/);

  // Admin page shows QR code pointing to the public URL
  res = await fetch(srv.base + adminPath, { headers: { authorization: AUTH } });
  const html = await res.text();
  assert.match(html, /<svg/);
  assert.ok(html.includes(`${srv.base}/p/mehr-baeume`));

  res = await fetch(`${srv.base}${adminPath}/qr.png`, { headers: { authorization: AUTH } });
  assert.equal(res.headers.get('content-type'), 'image/png');

  // Public form uses autofill hints
  res = await fetch(`${srv.base}/p/mehr-baeume`);
  const page = await res.text();
  for (const ac of ['name', 'address-line1', 'postal-code', 'address-level2', 'email']) {
    assert.ok(page.includes(`autocomplete="${ac}"`), ac);
  }

  // Invalid submission is rejected with errors, values kept
  res = await post(`${srv.base}/p/mehr-baeume`, { ...validSignature, email: 'kaputt', consent: '' });
  assert.equal(res.status, 422);
  const errHtml = await res.text();
  assert.match(errHtml, /gültige E-Mail/);
  assert.match(errHtml, /Erika Mustermann/);

  // Valid submission
  res = await post(`${srv.base}/p/mehr-baeume`, validSignature);
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/p/mehr-baeume/danke');

  // Duplicate e-mail (case-insensitive) is not counted twice
  res = await post(`${srv.base}/p/mehr-baeume`, { ...validSignature, email: 'erika@example.org' });
  assert.equal(res.headers.get('location'), '/p/mehr-baeume/danke?bereits=1');

  // Honeypot is silently ignored
  res = await post(`${srv.base}/p/mehr-baeume`, { ...validSignature, email: 'bot@example.org', website: 'x' });
  assert.equal(res.status, 303);

  const p = srv.db.getPetitionBySlug('mehr-baeume');
  assert.equal(p.signature_count, 1);

  // CSV export
  res = await fetch(`${srv.base}${adminPath}/export.csv`, { headers: { authorization: AUTH } });
  const csv = await res.text();
  assert.match(csv, /"Erika Mustermann";"Hauptstraße 1";"12345";"Musterstadt";"erika@example.org"/);

  // Cross-site POST to admin is blocked
  res = await post(`${srv.base}${adminPath}/delete`, {}, { authorization: AUTH, origin: 'https://evil.example' });
  assert.equal(res.status, 403);

  // Closing the petition stops new signatures
  res = await post(`${srv.base}${adminPath}/close`, {}, { authorization: AUTH, origin: srv.base });
  assert.equal(res.status, 303);
  res = await post(`${srv.base}/p/mehr-baeume`, { ...validSignature, email: 'neu@example.org' });
  assert.equal(res.status, 409);
});

test('CSV export neutralises spreadsheet formulas', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const p = srv.db.createPetition({ title: 'Test', description: '', recipient: '', goal: 0 });
  srv.db.addSignature(p.id, { ...validSignature, name: '=HYPERLINK("x") Evil', email: 'a@b.de' });
  const res = await fetch(`${srv.base}/admin/p/${p.id}/export.csv`, { headers: { authorization: AUTH } });
  assert.match(await res.text(), /"'=HYPERLINK\(""x""\) Evil"/);
});

test('seed creates the initial petition once, never again after deletion', () => {
  const path = require('node:path');
  const { seedIfFresh } = require('../src/seed');
  const db = openDatabase(':memory:');
  const file = path.join(__dirname, '..', 'seed', 'petitionen.json');
  const [p] = seedIfFresh(db, file);
  assert.equal(p.slug, 'sitzplaetze-schulhof');
  assert.match(p.title, /Werner-von-Siemens-Realschule/);
  assert.equal(seedIfFresh(db, file).length, 0);
  db.deletePetition(p.id);
  assert.equal(seedIfFresh(db, file).length, 0);
  db.close();
});

test('form is prefilled with the petition city, handover PDFs are generated', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const path = require('node:path');
  const { seedIfFresh } = require('../src/seed');
  const [p] = seedIfFresh(srv.db, path.join(__dirname, '..', 'seed', 'petitionen.json'));

  const page = await (await fetch(`${srv.base}/p/${p.slug}`)).text();
  assert.match(page, /id="city"[^>]*value="Düsseldorf"/s);
  assert.match(page, /Oberbürgermeister der Landeshauptstadt Düsseldorf/);

  srv.db.addSignature(p.id, { ...validSignature, email: 'a@example.org' });
  srv.db.addSignature(p.id, { ...validSignature, name: 'Şükrü Łukasiewicz', city: 'Ratingen', email: 'b@example.org' });

  for (const file of ['uebergabe', 'zusammenfassung', 'unterschriftenliste']) {
    const res = await fetch(`${srv.base}/admin/p/${p.id}/${file}.pdf`, { headers: { authorization: AUTH } });
    assert.equal(res.status, 200, file);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
  }

  // Admin page shows key figures
  const admin = await (await fetch(`${srv.base}/admin/p/${p.id}`, { headers: { authorization: AUTH } })).text();
  assert.match(admin, /davon aus Düsseldorf/);
});

test('computeStats counts residents of the petition city', () => {
  const { computeStats } = require('../src/handover');
  const sigs = [
    { city: 'Düsseldorf', postal_code: '40210', created_at: '2026-10-01 08:00:00' },
    { city: 'duesseldorf', postal_code: '40210', created_at: '2026-10-02 08:00:00' },
    { city: 'Düsseldorf-Bilk', postal_code: '40225', created_at: '2026-10-03 08:00:00' },
    { city: 'Neuss', postal_code: '41460', created_at: '2026-10-04 23:30:00', is_adult: 0 },
  ];
  const stats = computeStats({ default_city: 'Düsseldorf' }, sigs);
  assert.equal(stats.total, 4);
  assert.equal(stats.fromHome, 3);
  assert.equal(stats.minors, 1);
  assert.equal(stats.unknownAge, 3);
  assert.equal(stats.first, '01.10.2026');
  assert.equal(stats.last, '05.10.2026'); // 23:30 UTC = 01:30 Uhr deutscher Zeit
  assert.deepEqual(stats.byCity[0], { label: 'Düsseldorf', count: 2 });
  assert.deepEqual(stats.byPostalCode[0], { label: '40210', count: 2 });
});

test('admin can edit a petition', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const p = srv.db.createPetition({ title: 'Alt', goal: 0 });
  const res = await post(`${srv.base}/admin/p/${p.id}/edit`, {
    title: 'Neu', recipient: 'OB', recipient_address: 'Rathaus', initiator: 'SMV',
    default_city: 'Düsseldorf', goal: '50', description: 'Text',
  }, { authorization: AUTH, origin: srv.base });
  assert.equal(res.status, 303);
  const updated = srv.db.getPetitionById(p.id);
  assert.equal(updated.title, 'Neu');
  assert.equal(updated.initiator, 'SMV');
  assert.equal(updated.goal, 50);
  assert.equal(updated.slug, p.slug, 'Link (und damit QR-Code) bleibt gleich');
});

test('minors can sign with parental consent and are marked', async (t) => {
  const srv = await startServer();
  t.after(srv.close);
  const p = srv.db.createPetition({ title: 'Schulhof', goal: 0 });
  const url = `${srv.base}/p/${p.slug}`;

  // Alter muss angegeben werden
  let res = await post(url, { ...validSignature, age: '' });
  assert.equal(res.status, 422);
  assert.match(await res.text(), /18 Jahre oder älter sind/);

  // Unter 18 ohne Einverständnis der Eltern wird abgelehnt
  res = await post(url, { ...validSignature, age: 'u18' });
  assert.equal(res.status, 422);
  assert.match(await res.text(), /Eltern einverstanden/);

  // Unter 18 mit Einverständnis klappt
  res = await post(url, { ...validSignature, name: 'Tim Klein', email: 'tim@example.org', age: 'u18', parental_consent: '1' });
  assert.equal(res.status, 303);
  // Volljährige: ein versehentlich mitgeschicktes Eltern-Häkchen wird nicht gespeichert
  res = await post(url, { ...validSignature, parental_consent: '1' });
  assert.equal(res.status, 303);

  const [adult, minor] = srv.db.listSignatures(p.id, { chronological: true }).sort((a, b) => a.is_adult - b.is_adult).reverse();
  assert.equal(minor.is_adult, 0);
  assert.equal(minor.parental_consent, 1);
  assert.equal(adult.is_adult, 1);
  assert.equal(adult.parental_consent, 0);

  const admin = await (await fetch(`${srv.base}/admin/p/${p.id}`, { headers: { authorization: AUTH } })).text();
  assert.match(admin, /Tim Klein <span class="tag minor">unter 18<\/span>/);
  assert.match(admin, /davon unter 18/);

  const csv = await (await fetch(`${srv.base}/admin/p/${p.id}/export.csv`, { headers: { authorization: AUTH } })).text();
  assert.match(csv, /"Volljährig";"Einverständnis Eltern"/);
  assert.match(csv, /"Tim Klein";.*"nein";"ja"/);
  assert.match(csv, /"Erika Mustermann";.*"ja";""/);

  const pdf = await fetch(`${srv.base}/admin/p/${p.id}/uebergabe.pdf`, { headers: { authorization: AUTH } });
  assert.equal(pdf.status, 200);
});
