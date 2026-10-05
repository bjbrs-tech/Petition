/**
 * Übergabe-Dokumente: Zusammenfassung und detaillierte Unterschriftenliste als PDF.
 * Beides wird bei jedem Abruf aus dem aktuellen Datenbestand erzeugt.
 */
const path = require('node:path');
const PDFDocument = require('pdfkit');
const { formatDate, today, formatNumber, formatPercent } = require('./format');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const COLORS = {
  text: '#1c2330', muted: '#5b6577', line: '#c9ced8', zebra: '#f2f4f7', accent: '#1f6f4a',
  minor: '#9a5200', minorBg: '#fdf0dc',
};
const MINOR_MARK = 'u18';
const MARGIN = 50;

// ---------- Auswertung ----------

const normalizePlace = (s) => String(s).toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z]/g, '');

function groupCount(items, keyOf, labelOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const g = groups.get(key) || { count: 0, labels: new Map() };
    g.count += 1;
    const label = labelOf(item);
    g.labels.set(label, (g.labels.get(label) || 0) + 1);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({ label: [...g.labels].sort((a, b) => b[1] - a[1])[0][0], count: g.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'));
}

function computeStats(petition, signatures) {
  const total = signatures.length;
  const home = normalizePlace(petition.default_city || '');
  const fromHome = home
    ? signatures.filter((s) => normalizePlace(s.city).startsWith(home)).length
    : null;
  const minors = signatures.filter((s) => s.is_adult === 0).length;
  const unknownAge = signatures.filter((s) => s.is_adult === null || s.is_adult === undefined).length;
  return {
    total,
    minors,
    adults: total - minors - unknownAge,
    unknownAge,
    fromHome,
    homeCity: petition.default_city || '',
    first: total ? formatDate(signatures[0].created_at) : null,
    last: total ? formatDate(signatures[total - 1].created_at) : null,
    byCity: groupCount(signatures, (s) => normalizePlace(s.city) || '?', (s) => s.city),
    byPostalCode: groupCount(signatures, (s) => s.postal_code, (s) => s.postal_code),
  };
}

// ---------- PDF-Hilfen ----------

function createDoc(petition, title) {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN + 20, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: `${title} – ${petition.title}`, Author: petition.initiator || 'Petitionsplattform' },
  });
  doc.registerFont('R', path.join(FONT_DIR, 'LiberationSans-Regular.ttf'));
  doc.registerFont('B', path.join(FONT_DIR, 'LiberationSans-Bold.ttf'));
  doc.font('R').fillColor(COLORS.text);
  return doc;
}

const contentWidth = (doc) => doc.page.width - doc.page.margins.left - doc.page.margins.right;
const bottomLimit = (doc) => doc.page.height - doc.page.margins.bottom;

/** Kürzt Text mit „…“, damit er in eine Tabellenzelle passt. */
function fit(doc, text, width) {
  let s = String(text ?? '');
  if (doc.widthOfString(s) <= width) return s;
  while (s.length && doc.widthOfString(`${s}…`) > width) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

function ensureSpace(doc, height, onNewPage) {
  if (doc.y + height > bottomLimit(doc)) {
    doc.addPage();
    if (onNewPage) onNewPage();
  }
}

function heading(doc, text) {
  ensureSpace(doc, 50);
  doc.moveDown(0.8).font('B').fontSize(13).fillColor(COLORS.accent).text(text, doc.page.margins.left);
  doc.moveDown(0.3).font('R').fontSize(10.5).fillColor(COLORS.text);
}

function finishWithFooters(doc, petition, label) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // sonst erzeugt Text im Rand eine neue Seite
    const y = doc.page.height - MARGIN;
    doc.moveTo(MARGIN, y - 6).lineTo(doc.page.width - MARGIN, y - 6).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.font('R').fontSize(8).fillColor(COLORS.muted);
    doc.text(fit(doc, `${label} · ${petition.title}`, contentWidth(doc) - 90), MARGIN, y, { lineBreak: false });
    doc.text(`Seite ${i + 1} von ${range.count}`, MARGIN, y, { width: contentWidth(doc), align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}

function toBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function paragraphs(doc, list, width) {
  list.forEach((text, i) => {
    if (i) doc.moveDown(0.5);
    doc.text(text.trim(), doc.page.margins.left, doc.y, { width, lineGap: 2 });
  });
}

// ---------- Zusammenfassung ----------

function drawSummary(doc, petition, stats) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);

  // Empfänger (Anschriftenfeld) und Datum
  doc.font('R').fontSize(8).fillColor(COLORS.muted)
    .text(petition.initiator ? `Absender: ${petition.initiator}` : 'Petition', left, MARGIN + 20);
  doc.moveDown(0.5).font('R').fontSize(11).fillColor(COLORS.text);
  if (petition.recipient) doc.text(petition.recipient);
  if (petition.recipient_address) doc.text(petition.recipient_address);
  const place = petition.default_city ? `${petition.default_city}, ` : '';
  doc.fontSize(10).text(`${place}${today()}`, left, MARGIN + 130, { width, align: 'right' });

  // Titel
  doc.moveDown(1.5).font('B').fontSize(9).fillColor(COLORS.muted)
    .text('ÜBERGABE DER PETITION – ZUSAMMENFASSUNG', left, doc.y, { characterSpacing: 0.5 });
  doc.moveDown(0.3).font('B').fontSize(18).fillColor(COLORS.text).text(petition.title, { width });
  if (petition.initiator) {
    doc.moveDown(0.3).font('R').fontSize(10.5).fillColor(COLORS.muted).text(`Eingereicht von: ${petition.initiator}`);
  }

  // Kennzahlen
  const boxes = [
    ['Unterschriften', formatNumber(stats.total), `davon ${formatNumber(stats.minors)} unter 18 Jahren`],
    stats.fromHome !== null
      ? [`davon aus ${stats.homeCity}`, `${formatNumber(stats.fromHome)} (${formatPercent(stats.fromHome, stats.total)})`]
      : ['Verschiedene Orte', formatNumber(stats.byCity.length)],
    ['Sammelzeitraum', stats.total ? `${stats.first} – ${stats.last}` : '–'],
  ];
  const gap = 10;
  const boxW = (width - gap * 2) / 3;
  const boxY = doc.y + 16;
  const boxH = 64;
  boxes.forEach(([label, value, sub], i) => {
    const x = left + i * (boxW + gap);
    doc.roundedRect(x, boxY, boxW, boxH, 6).fillColor(COLORS.zebra).fill();
    doc.font('R').fontSize(9).fillColor(COLORS.muted).text(label, x + 10, boxY + 10, { width: boxW - 20 });
    doc.font('B').fontSize(i === 2 ? 11.5 : 17).fillColor(COLORS.text)
      .text(value, x + 10, boxY + (i === 2 ? 30 : 26), { width: boxW - 20 });
    if (sub) doc.font('R').fontSize(8.5).fillColor(COLORS.muted).text(sub, x + 10, boxY + 47, { width: boxW - 20 });
  });
  doc.x = left;
  doc.y = boxY + boxH;

  if (petition.description) {
    heading(doc, 'Anliegen');
    paragraphs(doc, petition.description.split(/\n{2,}/), width);
  }

  const table = (title, rows, firstCol) => {
    if (!rows.length) return;
    heading(doc, title);
    const top = rows.slice(0, 12);
    const rest = rows.slice(12).reduce((sum, r) => sum + r.count, 0);
    if (rest) top.push({ label: `Sonstige (${rows.length - 12})`, count: rest });
    const cols = [width - 160, 70, 90];
    const row = (cells, bold, shade) => {
      ensureSpace(doc, 18);
      const y = doc.y;
      if (shade) doc.rect(left, y - 3, width, 17).fillColor(COLORS.zebra).fill();
      doc.font(bold ? 'B' : 'R').fontSize(10).fillColor(COLORS.text);
      doc.text(fit(doc, cells[0], cols[0] - 10), left + 6, y, { lineBreak: false });
      doc.text(cells[1], left + cols[0], y, { width: cols[1], align: 'right', lineBreak: false });
      doc.text(cells[2], left + cols[0] + cols[1], y, { width: cols[2] - 6, align: 'right', lineBreak: false });
      doc.x = left;
      doc.y = y + 17;
    };
    row([firstCol, 'Anzahl', 'Anteil'], true, false);
    top.forEach((r, i) => row([r.label, formatNumber(r.count), formatPercent(r.count, stats.total)], false, i % 2 === 0));
  };
  table('Altersgruppen', [
    { label: '18 Jahre oder älter', count: stats.adults },
    { label: `Unter 18 Jahren (in der Liste mit „${MINOR_MARK}“ gekennzeichnet)`, count: stats.minors },
    ...(stats.unknownAge ? [{ label: 'Ohne Altersangabe', count: stats.unknownAge }] : []),
  ], 'Alter');
  table('Wohnorte der Unterzeichnenden', stats.byCity, 'Ort');
  table('Häufigste Postleitzahlen', stats.byPostalCode, 'PLZ');

  heading(doc, 'Hinweise');
  paragraphs(doc, [
    `Die vollständige Unterschriftenliste mit ${formatNumber(stats.total)} Einträgen (Name und Anschrift) liegt als Anlage bei.`,
    'Die Unterschriften wurden online über ein Formular gesammelt, das per QR-Code aufgerufen wurde. '
      + 'Jede E-Mail-Adresse konnte die Petition nur einmal unterzeichnen; Mehrfachunterschriften sind dadurch ausgeschlossen.',
    'Alle Unterzeichnenden haben der Weitergabe von Name und Anschrift an den Empfänger der Petition zugestimmt. '
      + 'E-Mail-Adressen werden aus Datenschutzgründen nicht weitergegeben.',
    `Auch Minderjährige konnten unterzeichnen. Sie haben angegeben, unter 18 Jahre alt zu sein, und bestätigt, `
      + `dass ihre Erziehungsberechtigten einverstanden sind. In der Unterschriftenliste sind sie in der Spalte `
      + `„Alter“ mit „${MINOR_MARK}“ gekennzeichnet und farbig hinterlegt.`,
  ], width);
}

// ---------- Detaillierte Liste ----------

const LIST_COLS = [
  { key: 'nr', label: 'Nr.', width: 32, align: 'right' },
  { key: 'name', label: 'Name', width: 125 },
  { key: 'street', label: 'Straße, Hausnummer', width: 125 },
  { key: 'postal_code', label: 'PLZ', width: 40 },
  { key: 'city', label: 'Ort', width: 86 },
  { key: 'age', label: 'Alter', width: 36, align: 'center' },
  { key: 'date', label: 'Datum', width: 60 },
];

const ageLabel = (s) => {
  if (s.is_adult === 0) return MINOR_MARK;
  if (s.is_adult === 1) return '18+';
  return '–';
};

function drawList(doc, petition, signatures) {
  const left = doc.page.margins.left;
  const width = contentWidth(doc);
  const scale = width / LIST_COLS.reduce((s, c) => s + c.width, 0);
  const cols = LIST_COLS.map((c) => ({ ...c, width: c.width * scale }));
  const rowH = 16;

  const pageHeader = () => {
    doc.font('B').fontSize(9).fillColor(COLORS.muted)
      .text('ANLAGE: UNTERSCHRIFTENLISTE', left, MARGIN, { characterSpacing: 0.5 });
    doc.font('B').fontSize(12).fillColor(COLORS.text).text(petition.title, { width });
    doc.font('R').fontSize(9).fillColor(COLORS.muted)
      .text(`${petition.recipient ? `An: ${petition.recipient} · ` : ''}Stand: ${today()} · ${formatNumber(signatures.length)} Unterschriften`);
    doc.text(`Alter: 18+ = volljährig · ${MINOR_MARK} = minderjährig (unter 18 Jahre, Einverständnis der Erziehungsberechtigten bestätigt)`);
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(left, y, width, rowH + 2).fillColor(COLORS.accent).fill();
    let x = left;
    doc.font('B').fontSize(9).fillColor('#ffffff');
    for (const c of cols) {
      doc.text(c.label, x + 4, y + 5, { width: c.width - 8, align: c.align || 'left', lineBreak: false });
      x += c.width;
    }
    doc.x = left;
    doc.y = y + rowH + 2;
  };

  pageHeader();
  doc.font('R').fontSize(9);
  signatures.forEach((s, i) => {
    const minor = s.is_adult === 0;
    const cells = { ...s, nr: String(i + 1), age: ageLabel(s), date: formatDate(s.created_at) };
    // Lange Namen/Orte werden umbrochen statt abgeschnitten – die Liste muss vollständig sein.
    doc.font('R').fontSize(9);
    const h = Math.max(rowH, ...cols.map((c) => doc.heightOfString(String(cells[c.key] ?? ''), { width: c.width - 8 }) + 7));
    ensureSpace(doc, h, pageHeader);
    const y = doc.y;
    if (minor) doc.rect(left, y, width, h).fillColor(COLORS.minorBg).fill();
    else if (i % 2 === 1) doc.rect(left, y, width, h).fillColor(COLORS.zebra).fill();
    let x = left;
    for (const c of cols) {
      const marked = c.key === 'age' && minor;
      doc.font(marked ? 'B' : 'R').fontSize(9).fillColor(marked ? COLORS.minor : COLORS.text);
      doc.text(String(cells[c.key] ?? ''), x + 4, y + 4, { width: c.width - 8, align: c.align || 'left' });
      x += c.width;
    }
    doc.x = left;
    doc.y = y + h;
  });
  if (!signatures.length) {
    doc.moveDown().font('R').fontSize(10).fillColor(COLORS.muted).text('Noch keine Unterschriften vorhanden.', left);
  }

  // Abschluss mit Bestätigung
  ensureSpace(doc, 120, pageHeader);
  doc.moveDown(1.2).font('B').fontSize(10.5).fillColor(COLORS.text)
    .text(`Gesamt: ${formatNumber(signatures.length)} Unterschriften`, left);
  const minors = signatures.filter((s) => s.is_adult === 0).length;
  const unknown = signatures.filter((s) => s.is_adult === null || s.is_adult === undefined).length;
  doc.font('R').fontSize(10).text(`davon ${formatNumber(signatures.length - minors - unknown)} volljährig und `
    + `${formatNumber(minors)} minderjährig (${MINOR_MARK})${unknown ? `, ${formatNumber(unknown)} ohne Altersangabe` : ''}`, left);
  doc.moveDown(0.4).font('R').fontSize(10)
    .text('Die Vollständigkeit und Richtigkeit dieser Liste wird bestätigt.', left);
  const lineY = doc.y + 50;
  const half = (width - 30) / 2;
  doc.moveTo(left, lineY).lineTo(left + half, lineY)
    .moveTo(left + half + 30, lineY).lineTo(left + width, lineY)
    .lineWidth(0.7).strokeColor(COLORS.text).stroke();
  doc.font('R').fontSize(8.5).fillColor(COLORS.muted);
  doc.text('Ort, Datum', left, lineY + 4, { lineBreak: false });
  doc.text(`Unterschrift${petition.initiator ? ` (${petition.initiator})` : ''}`, left + half + 30, lineY + 4, {
    width: half, lineBreak: false,
  });
}

// ---------- Öffentliche Funktionen ----------

async function summaryPdf(petition, signatures) {
  const doc = createDoc(petition, 'Zusammenfassung');
  const out = toBuffer(doc);
  drawSummary(doc, petition, computeStats(petition, signatures));
  finishWithFooters(doc, petition, 'Zusammenfassung');
  return out;
}

async function listPdf(petition, signatures) {
  const doc = createDoc(petition, 'Unterschriftenliste');
  const out = toBuffer(doc);
  drawList(doc, petition, signatures);
  finishWithFooters(doc, petition, 'Unterschriftenliste');
  return out;
}

async function handoverPdf(petition, signatures) {
  const doc = createDoc(petition, 'Übergabe');
  const out = toBuffer(doc);
  drawSummary(doc, petition, computeStats(petition, signatures));
  doc.addPage();
  drawList(doc, petition, signatures);
  finishWithFooters(doc, petition, 'Übergabe der Petition');
  return out;
}

module.exports = { computeStats, summaryPdf, listPdf, handoverPdf };
