const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const QRCode = require('qrcode');
const views = require('./views');
const handover = require('./handover');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function clean(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validateSignature(body) {
  const values = {
    name: clean(body.name, 120),
    street: clean(body.street, 160),
    postal_code: clean(body.postal_code, 10),
    city: clean(body.city, 100),
    email: clean(body.email, 254).toLowerCase(),
    consent: body.consent === '1',
  };
  const errors = {};
  if (values.name.length < 3 || !values.name.includes(' ')) errors.name = 'Bitte Vor- und Nachnamen angeben.';
  if (values.street.length < 3) errors.street = 'Bitte Straße und Hausnummer angeben.';
  if (!/^[0-9A-Za-z -]{4,10}$/.test(values.postal_code)) errors.postal_code = 'Bitte eine gültige PLZ angeben.';
  if (values.city.length < 2) errors.city = 'Bitte den Ort angeben.';
  if (!EMAIL_RE.test(values.email)) errors.email = 'Bitte eine gültige E-Mail-Adresse angeben.';
  if (!values.consent) errors.consent = 'Bitte bestätigen Sie Ihre Zustimmung.';
  return { values, errors };
}

function parsePetitionForm(body) {
  const values = {
    title: clean(body.title, 200),
    recipient: clean(body.recipient, 200),
    recipient_address: String(body.recipient_address ?? '').replace(/\r\n/g, '\n').trim().slice(0, 500),
    initiator: clean(body.initiator, 200),
    default_city: clean(body.default_city, 100),
    goal: Math.max(0, Math.min(10_000_000, Number.parseInt(body.goal, 10) || 0)),
    description: String(body.description ?? '').replace(/\r\n/g, '\n').trim().slice(0, 20000),
  };
  const errors = {};
  if (values.title.length < 3) errors.title = 'Bitte einen Titel mit mindestens 3 Zeichen angeben.';
  return { values, errors };
}

/** Very small fixed-window rate limiter, keyed by client IP. */
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    let entry = hits.get(key);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
      if (hits.size > 10000) {
        for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
      }
    }
    entry.count += 1;
    if (entry.count > max) {
      res.status(429).type('text').send('Zu viele Anfragen. Bitte versuchen Sie es gleich noch einmal.');
      return;
    }
    next();
  };
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function basicAuth({ user, password }) {
  return (req, res, next) => {
    const header = req.get('authorization') || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      if (idx !== -1 && safeEqual(decoded.slice(0, idx), user) && safeEqual(decoded.slice(idx + 1), password)) {
        return next();
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Petition Verwaltung", charset="UTF-8"');
    res.status(401).type('text').send('Anmeldung erforderlich.');
  };
}

/** Rejects cross-site form posts (CSRF protection for cookie-less Basic Auth). */
function sameOrigin(req, res, next) {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin') || req.get('referer');
  if (origin) {
    try {
      if (new URL(origin).host === req.get('host')) return next();
    } catch { /* fall through */ }
    return res.status(403).type('text').send('Ungültige Herkunft der Anfrage.');
  }
  if (req.get('sec-fetch-site') && req.get('sec-fetch-site') !== 'same-origin') {
    return res.status(403).type('text').send('Ungültige Herkunft der Anfrage.');
  }
  next();
}

function createApp({ db, adminUser = 'admin', adminPassword, publicUrl, trustProxy = false }) {
  if (!adminPassword) throw new Error('ADMIN_PASSWORD muss gesetzt sein.');

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
    });
    next();
  });
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '50kb' }));

  const baseUrl = (req) => (publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  const petitionUrl = (req, p) => `${baseUrl(req)}/p/${p.slug}`;
  const qrOptions = { errorCorrectionLevel: 'M', margin: 2 };

  // ---------- Öffentlicher Bereich ----------

  app.get('/', (req, res) => {
    res.send(views.home(db.listPetitions({ onlyOpen: true })));
  });

  app.get('/p/:slug', (req, res) => {
    const p = db.getPetitionBySlug(req.params.slug);
    if (!p) return res.status(404).send(views.notFound());
    res.send(views.petition(p));
  });

  app.post('/p/:slug', rateLimiter({ windowMs: 60_000, max: 20 }), (req, res) => {
    const p = db.getPetitionBySlug(req.params.slug);
    if (!p) return res.status(404).send(views.notFound());
    if (!p.is_open) return res.status(409).send(views.petition(p));

    // Honeypot: Bots füllen das versteckte Feld aus – so tun, als sei alles gut.
    if (req.body.website) return res.redirect(303, `/p/${p.slug}/danke`);

    const { values, errors } = validateSignature(req.body);
    if (Object.keys(errors).length) {
      return res.status(422).send(views.petition(p, { values, errors }));
    }
    const stored = db.addSignature(p.id, values);
    res.redirect(303, `/p/${p.slug}/danke${stored ? '' : '?bereits=1'}`);
  });

  app.get('/p/:slug/danke', (req, res) => {
    const p = db.getPetitionBySlug(req.params.slug);
    if (!p) return res.status(404).send(views.notFound());
    res.send(views.thanks(p, { duplicate: req.query.bereits === '1' }));
  });

  // ---------- Verwaltung ----------

  const admin = express.Router();
  admin.use(basicAuth({ user: adminUser, password: adminPassword }));
  admin.use(sameOrigin);
  admin.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  const loadPetition = (req, res, next) => {
    const id = Number(req.params.id);
    req.petition = Number.isInteger(id) ? db.getPetitionById(id) : undefined;
    if (!req.petition) return res.status(404).send(views.notFound());
    next();
  };

  admin.get('/', (req, res) => {
    res.send(views.adminIndex(db.listPetitions()));
  });

  admin.post('/petitions', (req, res) => {
    const { values, errors } = parsePetitionForm(req.body);
    if (Object.keys(errors).length) {
      return res.status(422).send(views.adminIndex(db.listPetitions(), { values, errors }));
    }
    const p = db.createPetition(values);
    res.redirect(303, `/admin/p/${p.id}`);
  });

  const renderAdminPetition = async (req, res, form) => {
    const p = req.petition;
    const url = petitionUrl(req, p);
    const svg = await QRCode.toString(url, { ...qrOptions, type: 'svg' });
    const stats = handover.computeStats(p, db.listSignatures(p.id, { chronological: true }));
    return views.adminPetition(p, db.listSignatures(p.id), url, svg, stats, form);
  };

  admin.get('/p/:id', loadPetition, async (req, res, next) => {
    try {
      res.send(await renderAdminPetition(req, res));
    } catch (err) { next(err); }
  });

  admin.post('/p/:id/edit', loadPetition, async (req, res, next) => {
    try {
      const { values, errors } = parsePetitionForm(req.body);
      if (Object.keys(errors).length) {
        return res.status(422).send(await renderAdminPetition(req, res, { values, errors }));
      }
      db.updatePetition(req.petition.id, values);
      res.redirect(303, `/admin/p/${req.petition.id}`);
    } catch (err) { next(err); }
  });

  const pdfRoute = (file, build) => admin.get(`/p/:id/${file}.pdf`, loadPetition, async (req, res, next) => {
    try {
      const p = req.petition;
      const pdf = await build(p, db.listSignatures(p.id, { chronological: true }));
      res.type('application/pdf');
      res.attachment(`${file}-${p.slug}.pdf`);
      res.send(pdf);
    } catch (err) { next(err); }
  });
  pdfRoute('uebergabe', handover.handoverPdf);
  pdfRoute('zusammenfassung', handover.summaryPdf);
  pdfRoute('unterschriftenliste', handover.listPdf);

  admin.get('/p/:id/poster', loadPetition, async (req, res, next) => {
    try {
      const url = petitionUrl(req, req.petition);
      const svg = await QRCode.toString(url, { ...qrOptions, type: 'svg', errorCorrectionLevel: 'Q' });
      res.send(views.poster(req.petition, url, svg));
    } catch (err) { next(err); }
  });

  admin.get('/p/:id/qr.svg', loadPetition, async (req, res, next) => {
    try {
      const svg = await QRCode.toString(petitionUrl(req, req.petition), { ...qrOptions, type: 'svg' });
      res.type('image/svg+xml').send(svg);
    } catch (err) { next(err); }
  });

  admin.get('/p/:id/qr.png', loadPetition, async (req, res, next) => {
    try {
      const png = await QRCode.toBuffer(petitionUrl(req, req.petition), { ...qrOptions, type: 'png', width: 1024 });
      res.type('image/png').send(png);
    } catch (err) { next(err); }
  });

  admin.get('/p/:id/export.csv', loadPetition, (req, res) => {
    const cell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // Schutz vor Formel-Injection in Excel
      return `"${s.replace(/"/g, '""')}"`;
    };
    const header = ['Datum (UTC)', 'Name', 'Straße', 'PLZ', 'Ort', 'E-Mail'];
    const lines = db.listSignatures(req.petition.id, { chronological: true }).map((s) =>
      [s.created_at, s.name, s.street, s.postal_code, s.city, s.email].map(cell).join(';'));
    res.type('text/csv; charset=utf-8');
    res.attachment(`unterschriften-${req.petition.slug}.csv`);
    res.send(`﻿${[header.map(cell).join(';'), ...lines].join('\r\n')}\r\n`);
  });

  admin.post('/p/:id/close', loadPetition, (req, res) => {
    db.setPetitionOpen(req.petition.id, false);
    res.redirect(303, `/admin/p/${req.petition.id}`);
  });

  admin.post('/p/:id/open', loadPetition, (req, res) => {
    db.setPetitionOpen(req.petition.id, true);
    res.redirect(303, `/admin/p/${req.petition.id}`);
  });

  admin.post('/p/:id/delete', loadPetition, (req, res) => {
    db.deletePetition(req.petition.id);
    res.redirect(303, '/admin');
  });

  admin.post('/p/:id/signatures/:sid/delete', loadPetition, (req, res) => {
    db.deleteSignature(req.petition.id, Number(req.params.sid));
    res.redirect(303, `/admin/p/${req.petition.id}`);
  });

  app.use('/admin', admin);

  app.use((req, res) => res.status(404).send(views.notFound()));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).type('text').send('Interner Fehler.');
  });

  return app;
}

module.exports = { createApp, validateSignature };
