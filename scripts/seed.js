const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../backend/data');
const db = new Database(path.join(__dirname, '../backend/dodge.db'));
db.pragma('journal_mode = WAL');

function loadAllJsonlFromFolder(folder) {
  const folderPath = path.join(DATA_DIR, folder);
  if (!fs.existsSync(folderPath)) return [];
  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl')).sort();
  if (!files.length) return [];
  let allRows = [];
  for (const file of files) {
    const filepath = path.join(folderPath, file);
    const lines = fs.readFileSync(filepath, 'utf-8').trim().split('\n');
    const rows = lines.filter(l => l.trim()).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    allRows = allRows.concat(rows);
  }
  return allRows;
}

function createAndInsert(tableName, rows) {
  if (!rows.length) { console.log(`  SKIP: ${tableName} — no data`); return; }
  const keys = Object.keys(rows[0]);
  const cols = keys.map(k => `"${k}" TEXT`).join(', ');
  db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
  db.exec(`CREATE TABLE "${tableName}" (${cols})`);
  const placeholders = keys.map(() => '?').join(', ');
  const insert = db.prepare(`INSERT INTO "${tableName}" VALUES (${placeholders})`);
  const insertMany = db.transaction((items) => {
    for (const item of items) {
      insert.run(keys.map(k => {
        const v = item[k];
        if (v === undefined || v === null) return null;
        if (typeof v === 'number') return Number.isFinite(v) ? v : null;
        if (typeof v === 'boolean') return v ? 1 : 0;
        if (typeof v === 'object') { try { return JSON.stringify(v); } catch { return null; } }
        return String(v);
      }));
    }
  });
  insertMany(rows);
  console.log(`  OK: ${tableName} — ${rows.length} rows`);
}

const tables = [
  ['sales_order_headers','sales_order_headers'],
  ['sales_order_items','sales_order_items'],
  ['sales_order_schedule_lines','sales_order_schedule_lines'],
  ['outbound_delivery_headers','outbound_delivery_headers'],
  ['outbound_delivery_items','outbound_delivery_items'],
  ['billing_document_headers','billing_document_headers'],
  ['billing_document_items','billing_document_items'],
  ['billing_document_cancellations','billing_document_cancellations'],
  ['journal_entry_items_accounts_receivable','journal_entry_items'],
  ['payments_accounts_receivable','payments'],
  ['business_partners','business_partners'],
  ['business_partner_addresses','business_partner_addresses'],
  ['products','products'],
  ['product_descriptions','product_descriptions'],
  ['product_plants','product_plants'],
  ['product_storage_locations','product_storage_locations'],
  ['plants','plants'],
  ['customer_company_assignments','customer_company_assignments'],
  ['customer_sales_area_assignments','customer_sales_area_assignments'],
];

console.log('Seeding (all files per folder)...');
for (const [folder, tableName] of tables) {
  const rows = loadAllJsonlFromFolder(folder);
  createAndInsert(tableName, rows);
}
console.log('\nDone!');
db.close();
