const TZ = 'Europe/Berlin';

/** SQLite speichert UTC als 'YYYY-MM-DD HH:MM:SS'. */
const parseUtc = (value) => new Date(`${String(value).replace(' ', 'T')}Z`);

const formatDate = (value) => parseUtc(value).toLocaleDateString('de-DE', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
});

const formatDateTime = (value) => parseUtc(value).toLocaleString('de-DE', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const today = () => new Date().toLocaleDateString('de-DE', {
  timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric',
});

const formatNumber = (n) => n.toLocaleString('de-DE');

const formatPercent = (part, total) =>
  `${(total ? (part / total) * 100 : 0).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;

module.exports = { formatDate, formatDateTime, today, formatNumber, formatPercent };
