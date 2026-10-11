import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'opsmitra-sqlite-test-'));
process.env.DB_DRIVER = 'sqlite';
process.env.SQLITE_PATH = join(temporaryDirectory, 'test.sqlite');
const { pool } = await import('../src/db.js');

after(async () => {
  await pool.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('SQLite schema initializes with the unique indexes required by health checks', async () => {
  const [indexes] = await pool.query('SHOW INDEX FROM products');
  const ownerSku = indexes.filter(row => row.Key_name === 'uq_products_owner_sku');
  assert.deepEqual(ownerSku.map(row => row.Column_name), ['owner_id', 'sku']);
  assert.ok(ownerSku.every(row => row.Non_unique === 0));
});

test('SQLite connection transactions commit and roll back atomically', async () => {
  const [owner] = await pool.execute('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', ['Owner', 'tx@example.com', 'hash']);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute('INSERT INTO products (owner_id, sku, name) VALUES (?, ?, ?)', [owner.insertId, 'ROLLBACK', 'Temporary']);
    await connection.rollback();
    await connection.beginTransaction();
    await connection.execute('INSERT INTO products (owner_id, sku, name) VALUES (?, ?, ?)', [owner.insertId, 'COMMIT', 'Kept']);
    await connection.commit();
  } finally { connection.release(); }

  const [rows] = await pool.execute('SELECT sku FROM products WHERE owner_id = ? ORDER BY sku', [owner.insertId]);
  assert.deepEqual(rows.map(row => row.sku), ['COMMIT']);
});

test('SQLite serializes pool queries behind an active write transaction', async () => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  let queryFinished = false;
  const queuedQuery = pool.execute('SELECT COUNT(*) AS count FROM users').then(result => { queryFinished = true; return result; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queryFinished, false);
  await connection.commit();
  connection.release();
  const [[row]] = await queuedQuery;
  assert.equal(Number(row.count), 1);
});

test('SQLite constraint violations map to the existing duplicate-entry contract', async () => {
  await assert.rejects(
    () => pool.execute('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', ['Duplicate', 'tx@example.com', 'hash']),
    error => error.code === 'ER_DUP_ENTRY'
  );
});
