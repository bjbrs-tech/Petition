const fs = require('node:fs');

/**
 * Legt beim allerersten Start die Petitionen aus der Seed-Datei an.
 * Später gelöschte Petitionen werden nicht wiederhergestellt.
 */
function seedIfFresh(db, file) {
  if (db.hasEverCreatedPetitions() || !fs.existsSync(file)) return [];
  const entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  return entries.map((e) => db.createPetition({
    slug: e.slug,
    title: e.title,
    description: e.description ?? '',
    recipient: e.recipient ?? '',
    goal: Number(e.goal) || 0,
  }));
}

module.exports = { seedIfFresh };
