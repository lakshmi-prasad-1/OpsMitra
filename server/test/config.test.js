import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProductionConfig } from '../src/config.js';

const good = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), DB_DRIVER: 'sqlite', SQLITE_PATH: resolve('/data/opsmitra.sqlite'), CLIENT_ORIGIN: 'https://app.example.com', TRUST_PROXY_HOPS: '2', PROTOTYPE_RESET_LINKS: 'false' };

test('development and test environments are never blocked', () => {
  assert.deepEqual(checkProductionConfig({ NODE_ENV: 'development' }), { errors: [], warnings: [] });
  assert.deepEqual(checkProductionConfig({}), { errors: [], warnings: [] });
});

test('a correct production configuration has no errors or warnings', () => {
  assert.deepEqual(checkProductionConfig(good), { errors: [], warnings: [] });
});

test('each unsafe production setting is rejected with an actionable message', () => {
  const errorsFor = patch => checkProductionConfig({ ...good, ...patch }).errors.join(' | ');
  assert.match(errorsFor({ JWT_SECRET: 'short' }), /JWT_SECRET/);
  assert.match(errorsFor({ JWT_SECRET: 'replace_with_a_random_secret_at_least_32_characters_long' }), /JWT_SECRET/);
  assert.match(errorsFor({ SQLITE_PATH: undefined }), /persistent disk/);
  assert.match(errorsFor({ SQLITE_PATH: 'data/opsmitra.sqlite' }), /absolute path/);
  assert.match(errorsFor({ DB_DRIVER: 'mysql' }), /DB_DRIVER/);
  assert.match(errorsFor({ CLIENT_ORIGIN: undefined }), /CLIENT_ORIGIN/);
  assert.match(errorsFor({ CLIENT_ORIGIN: 'https://app.example.com/' }), /origins only/);
  assert.match(errorsFor({ PROTOTYPE_RESET_LINKS: 'true' }), /take over accounts/);
});

test('explicit opt-outs downgrade to warnings and a missing proxy count only warns', () => {
  const r = checkProductionConfig({ ...good, SQLITE_PATH: undefined, ALLOW_EPHEMERAL_DB: 'true', PROTOTYPE_RESET_LINKS: 'true', ALLOW_PUBLIC_RESET_LINKS: 'true', TRUST_PROXY_HOPS: '0' });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 2);
});

test('the server process refuses to start on a bad production config and does not create a database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'opsmitra-config-'));
  const dbPath = join(dir, 'should-not-exist.sqlite');
  const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const run = spawnSync(process.execPath, ['src/index.js'], { cwd: server, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'short', SQLITE_PATH: dbPath, CLIENT_ORIGIN: '', PORT: '0' } });
  try {
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Refusing to start/);
    assert.equal(existsSync(dbPath), false, 'a rejected config must not touch the database');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('production boot: serves health, sets Secure cookies, and shuts down cleanly on SIGTERM', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opsmitra-boot-'));
  const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const port = 4300 + Math.floor(Math.random() * 400);
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['src/index.js'], { cwd: server, env: { ...process.env, ...good, SQLITE_PATH: join(dir, 'prod.sqlite'), PORT: String(port), SERVE_CLIENT: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const exited = new Promise(r => child.on('exit', code => r(code)));
  try {
    let health;
    for (let i = 0; i < 60 && !health; i++) { try { health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(); } catch { await new Promise(r => setTimeout(r, 150)); } }
    assert.equal(health?.status, 'ok', out);
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-OpsMitra-Request': '1' }, body: JSON.stringify({ name: 'Prod Owner', email: 'prod@example.com', password: 'correct horse battery' }) });
    assert.equal(res.status, 201);
    const cookie = res.headers.getSetCookie().find(c => c.startsWith('opsmitra_session='));
    assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Strict/i);
    child.kill('SIGTERM');
    const code = await Promise.race([exited, new Promise(r => setTimeout(() => r('timeout'), 8000))]);
    // On Windows Node cannot deliver SIGTERM to a handler (it hard-terminates), so only assert the handler path on POSIX.
    if (process.platform !== 'win32') { assert.equal(code, 0); assert.match(out, /shutting down/); }
  } finally { child.kill('SIGKILL'); await exited; try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ } }
});
