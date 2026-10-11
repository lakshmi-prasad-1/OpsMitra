import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import Database from 'better-sqlite3';

const serverDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(process.env.SQLITE_PATH || resolve(serverDirectory, 'data/opsmitra.sqlite'));
const temporaryPath = `${destination}.import-${randomUUID()}`;
const tables = ['users', 'auth_attempt_limits', 'customers', 'products', 'orders', 'order_items', 'sales', 'sale_items'];
const mysqlConfig = {
  host: process.env.MYSQL_SOURCE_HOST || 'localhost',
  port: Number(process.env.MYSQL_SOURCE_PORT || 3306),
  user: process.env.MYSQL_SOURCE_USER,
  password: process.env.MYSQL_SOURCE_PASSWORD,
  database: process.env.MYSQL_SOURCE_NAME || 'opsmitra',
  dateStrings: true,
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: true
};

if (!mysqlConfig.user || !mysqlConfig.password) {
  throw new Error('Set MYSQL_SOURCE_USER and MYSQL_SOURCE_PASSWORD in server/.env before running this import.');
}
if (existsSync(destination)) {
  throw new Error(`Refusing to overwrite existing SQLite destination: ${destination}. Choose a new SQLITE_PATH.`);
}
mkdirSync(dirname(destination), { recursive: true });
const source = await mysql.createConnection(mysqlConfig);
let target;
try {
  target = new Database(temporaryPath);
  target.pragma('foreign_keys = ON');
  target.exec(readFileSync(resolve(serverDirectory, 'sql/schema.sqlite.sql'), 'utf8'));
  const counts = {};
  target.exec('BEGIN IMMEDIATE');
  try {
    for (const table of tables) {
      const [rows] = await source.query(`SELECT * FROM \`${table}\``);
      counts[table] = rows.length;
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      for (const row of rows) for (const [column, value] of Object.entries(row)) {
        if (/(^id$|_id$)/.test(column) && value !== null && BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error(`Cannot import ${table}.${column}: value exceeds the exact identifier range supported by this application.`);
        }
      }
      const insert = target.prepare(`INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      const insertMany = target.transaction(records => {
        for (const record of records) insert.run(...columns.map(column => record[column] ?? null));
      });
      insertMany(rows);
    }
    const foreignKeyErrors = target.pragma('foreign_key_check');
    if (foreignKeyErrors.length) throw new Error(`SQLite foreign-key verification failed: ${JSON.stringify(foreignKeyErrors.slice(0, 5))}`);
    const integrity = target.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error(`SQLite integrity verification failed: ${JSON.stringify(integrity)}`);
    for (const table of tables) {
      const actual = target.prepare(`SELECT COUNT(*) AS count FROM \`${table}\``).get().count;
      if (actual !== counts[table]) throw new Error(`Row-count mismatch for ${table}: source=${counts[table]}, destination=${actual}`);
    }
    target.exec('COMMIT');
  } catch (error) {
    if (target.inTransaction) target.exec('ROLLBACK');
    throw error;
  }
  target.close();
  target = null;
  await source.end();
  linkSync(temporaryPath, destination);
  rmSync(temporaryPath, { force: true });
  console.log(`Verified SQLite copy created at ${destination}`);
  for (const [table, count] of Object.entries(counts)) console.log(`${table}: ${count} rows`);
  console.log('The MySQL source was read only and was not changed.');
} catch (error) {
  if (target?.open) target.close();
  await source.end().catch(() => {});
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${temporaryPath}${suffix}`, { force: true });
  throw error;
}
