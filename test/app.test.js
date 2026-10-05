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
  for (const ac of ['name', 'street-address', 'postal-code', 'address-level2', 'email']) {
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
