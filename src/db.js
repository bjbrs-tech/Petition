const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS petitions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      recipient   TEXT NOT NULL DEFAULT '',
      goal        INTEGER NOT NULL DEFAULT 0,
      is_open     INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signatures (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      petition_id INTEGER NOT NULL REFERENCES petitions(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      street      TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      city        TEXT NOT NULL,
      email       TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (petition_id, email)
    );
  `);

  const stmt = {
    listPetitions: db.prepare(`
      SELECT p.*, COUNT(s.id) AS signature_count
      FROM petitions p LEFT JOIN signatures s ON s.petition_id = p.id
      GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`),
    listOpenPetitions: db.prepare(`
      SELECT p.*, COUNT(s.id) AS signature_count
      FROM petitions p LEFT JOIN signatures s ON s.petition_id = p.id
      WHERE p.is_open = 1
      GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC`),
    petitionBySlug: db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM signatures s WHERE s.petition_id = p.id) AS signature_count
      FROM petitions p WHERE p.slug = ?`),
    petitionById: db.prepare(`
      SELECT p.*, (SELECT COUNT(*) FROM signatures s WHERE s.petition_id = p.id) AS signature_count
      FROM petitions p WHERE p.id = ?`),
    slugExists: db.prepare('SELECT 1 FROM petitions WHERE slug = ?'),
    insertPetition: db.prepare(`
      INSERT INTO petitions (slug, title, description, recipient, goal)
      VALUES (?, ?, ?, ?, ?)`),
    setOpen: db.prepare('UPDATE petitions SET is_open = ? WHERE id = ?'),
    deletePetition: db.prepare('DELETE FROM petitions WHERE id = ?'),
    insertSignature: db.prepare(`
      INSERT INTO signatures (petition_id, name, street, postal_code, city, email)
      VALUES (?, ?, ?, ?, ?, ?)`),
    listSignatures: db.prepare(`
      SELECT * FROM signatures WHERE petition_id = ? ORDER BY created_at DESC, id DESC`),
    deleteSignature: db.prepare('DELETE FROM signatures WHERE id = ? AND petition_id = ?'),
  };

  return {
    raw: db,
    listPetitions: ({ onlyOpen = false } = {}) =>
      (onlyOpen ? stmt.listOpenPetitions : stmt.listPetitions).all(),
    getPetitionBySlug: (slug) => stmt.petitionBySlug.get(slug),
    getPetitionById: (id) => stmt.petitionById.get(id),
    createPetition({ title, description, recipient, goal }) {
      const base = slugify(title) || 'petition';
      let slug = base;
      for (let i = 2; stmt.slugExists.get(slug); i++) slug = `${base}-${i}`;
      const info = stmt.insertPetition.run(slug, title, description, recipient, goal);
      return stmt.petitionById.get(info.lastInsertRowid);
    },
    setPetitionOpen: (id, open) => stmt.setOpen.run(open ? 1 : 0, id),
    deletePetition: (id) => stmt.deletePetition.run(id),
    /** Returns true if stored, false if this e-mail already signed the petition. */
    addSignature(petitionId, s) {
      try {
        stmt.insertSignature.run(petitionId, s.name, s.street, s.postal_code, s.city, s.email);
        return true;
      } catch (err) {
        if (/UNIQUE constraint failed/.test(err.message)) return false;
        throw err;
      }
    },
    listSignatures: (petitionId) => stmt.listSignatures.all(petitionId),
    deleteSignature: (petitionId, id) => stmt.deleteSignature.run(id, petitionId),
    close: () => db.close(),
  };
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

module.exports = { openDatabase, slugify };
