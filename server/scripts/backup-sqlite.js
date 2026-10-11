// Consistent online backup of the SQLite database (safe while the API is running).
//   npm run backup --prefix server                  -> <database folder>/backups/opsmitra-YYYYMMDD-HHMMSS.sqlite
//   node scripts/backup-sqlite.js /some/folder      -> into that folder instead
// Never modifies or deletes the live database or existing backups.
import 'dotenv/config';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(process.env.SQLITE_PATH || join(serverDirectory, 'data/opsmitra.sqlite'));
if (!existsSync(source)) { console.error(`No database found at ${source}`); process.exit(1); }

const target = resolve(process.argv[2] || join(dirname(source), 'backups'));
mkdirSync(target, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const destination = join(target, `opsmitra-${stamp}.sqlite`);
if (existsSync(destination)) { console.error(`Refusing to overwrite existing backup ${destination}`); process.exit(1); }

const database = new Database(source, { readonly: true, fileMustExist: true });
try {
  await database.backup(destination);
} finally { database.close(); }

// Make the backup one self-contained file (no -wal/-shm companions), then prove it is healthy and complete.
const finalise = new Database(destination);
finalise.pragma('journal_mode = DELETE');
finalise.close();
const copy = new Database(destination, { readonly: true });
const integrity = copy.pragma('integrity_check', { simple: true });
const counts = Object.fromEntries(['users', 'products', 'customers', 'sales', 'orders'].map(t => [t, copy.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
copy.close();
if (integrity !== 'ok') { console.error(`Backup written to ${destination} but integrity_check reported: ${integrity}`); process.exit(1); }
console.log(`Backup OK: ${destination}`);
console.log('Rows:', counts);
