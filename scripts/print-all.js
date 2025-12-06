
/**
 * scripts/print-all.js
 * يقرأ كل السجلات ويطبعها JSON منسّق
 */
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'app.db');
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) { console.error('❌ فتح قاعدة البيانات فشل:', err.message); process.exit(1); }
});

const SQL = `
  SELECT *
  FROM telemetry
  ORDER BY datetime(created_at) DESC
`;

db.all(SQL, [], (err, rows) => {
  if (err) { console.error('❌ قراءة البيانات فشلت:', err.message); process.exit(1); }
  console.log(`✅ إجمالي السجلات: ${rows.length}`);
  const parsed = rows.map(r => ({
    ...r,
    extra_json: (() => { try { return r.extra_json ? JSON.parse(r.extra_json) : {}; } catch { return r.extra_json; } })()
  }));
  console.log(JSON.stringify(parsed, null, 2));
  db.close();
});
