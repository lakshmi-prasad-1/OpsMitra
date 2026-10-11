import test from 'node:test';
import assert from 'node:assert/strict';
import { recordAuthAttempt } from '../src/services/authRateLimit.js';

test('authentication attempts are incremented atomically and read back by client key', async () => {
  let count = 0;
  const calls = [];
  const db = {
    async execute(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('INSERT INTO auth_attempt_limits')) count += 1;
      if (sql.startsWith('SELECT attempt_count')) return [[{ attemptCount: count }], []];
      return [{ affectedRows: 1 }, []];
    }
  };

  assert.equal(await recordAuthAttempt(db, 'a'.repeat(64)), 1);
  assert.equal(await recordAuthAttempt(db, 'a'.repeat(64)), 2);
  assert.equal(calls.filter(call => call.sql.includes('ON DUPLICATE KEY UPDATE')).length, 2);
  assert.ok(calls.every(call => call.params[0] === 'a'.repeat(64)));
});

test('missing persisted attempt counters fail closed', async () => {
  const db = { async execute(sql) { return sql.startsWith('SELECT') ? [[], []] : [{ affectedRows: 1 }, []]; } };
  await assert.rejects(() => recordAuthAttempt(db, 'b'.repeat(64)), /not persisted/i);
});

test('SQLite authentication attempts use a conflict-safe window upsert', async () => {
  let count = 0;
  const statements = [];
  const db = {
    driver: 'sqlite',
    async execute(sql, params) {
      statements.push(sql);
      if (sql.includes('INSERT INTO auth_attempt_limits')) count += 1;
      if (sql.startsWith('SELECT attempt_count')) return [[{ attemptCount: count }], []];
      assert.deepEqual(params, ['c'.repeat(64)]);
      return [{ affectedRows: 1 }, []];
    }
  };
  assert.equal(await recordAuthAttempt(db, 'c'.repeat(64)), 1);
  assert.match(statements[0], /ON CONFLICT\(client_key\) DO UPDATE/);
  assert.match(statements[0], /datetime\('now', '-15 minutes'\)/);
});