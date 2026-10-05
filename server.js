const path = require('node:path');
const { openDatabase } = require('./src/db');
const { createApp } = require('./src/app');
const { seedIfFresh } = require('./src/seed');

const port = Number(process.env.PORT) || 3000;
const dbFile = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'petition.sqlite');

if (!process.env.ADMIN_PASSWORD) {
  console.error('Bitte ADMIN_PASSWORD setzen, z. B.: ADMIN_PASSWORD=geheim npm start');
  process.exit(1);
}

const db = openDatabase(dbFile);
for (const p of seedIfFresh(db, process.env.SEED_FILE || path.join(__dirname, 'seed', 'petitionen.json'))) {
  console.log(`Petition angelegt: „${p.title}“ → /p/${p.slug}`);
}
const app = createApp({
  db,
  adminUser: process.env.ADMIN_USER || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD,
  publicUrl: process.env.PUBLIC_URL,
  trustProxy: process.env.TRUST_PROXY === '1' ? 1 : false,
});

const server = app.listen(port, () => {
  console.log(`Petitionsplattform läuft auf http://localhost:${port}`);
  console.log(`Verwaltung: http://localhost:${port}/admin`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
}
