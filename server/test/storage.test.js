import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDatabaseDirectory } from '../src/dbPath.js';

const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = () => mkdtempSync(join(tmpdir(), 'opsmitra-storage-'));

test('preflight creates missing nested folders and leaves an existing database untouched', () => {
  const root = tmp();
  try {
    const db = join(root, 'a', 'b', 'opsmitra.sqlite');
    prepareDatabaseDirectory(db);
    assert.equal(existsSync(join(root, 'a', 'b')), true);
    writeFileSync(db, 'precious data');
    prepareDatabaseDirectory(db);
    assert.equal(readFileSync(db, 'utf8'), 'precious data');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preflight explains the problem when the folder cannot be used', () => {
  const root = tmp();
  try {
    const blocker = join(root, 'blocker');
    writeFileSync(blocker, 'a file where a folder is needed');
    assert.throws(() => prepareDatabaseDirectory(join(blocker, 'opsmitra.sqlite')), error => {
      assert.match(error.message, /Cannot open the database at/);
      assert.match(error.message, /entrypoint/);
      assert.match(error.message, /was not touched/);
      return true;
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preflight reports an unwritable folder (POSIX, non-root only)', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const root = tmp();
  try {
    const dir = join(root, 'readonly');
    mkdirSync(dir);
    chmodSync(dir, 0o555);
    assert.throws(() => prepareDatabaseDirectory(join(dir, 'opsmitra.sqlite')), /cannot write to/);
  } finally { chmodSync(join(root, 'readonly'), 0o755); rmSync(root, { recursive: true, force: true }); }
});

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

/** Run docker-entrypoint.sh with stand-ins for id/setpriv/chown so the logic can be checked without root or Linux. */
function runEntrypoint({ uid = '0', dirWritable, fileExists = false, fileWritable = true, sqlitePath, args = ['echo', 'started'] }) {
  const root = tmp();
  const bin = join(root, 'bin');
  const log = join(root, 'calls.log');
  mkdirSync(bin);
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  stub('id', `case "$1:$2" in -u:) echo ${uid};; -u:node) echo 1000;; -g:node) echo 1000;; esac`);
  stub('chown', 'echo "chown $*" >> "$STUB_LOG"');
  // Real setpriv only drops privileges; the stub answers "is it writable for the app user?" and records the final exec.
  stub('setpriv', `while [ $# -gt 0 ]; do case "$1" in --*) shift;; *) break;; esac; done
if [ "$1" = test ]; then
  case "$3" in
    *.sqlite*) [ "$STUB_FILE_WRITABLE" = 1 ];;
    *) [ "$STUB_DIR_WRITABLE" = 1 ];;
  esac
  exit $?
fi
echo "exec-as-app $*" >> "$STUB_LOG"
exec "$@"`);
  const dir = join(root, 'data');
  mkdirSync(dir);
  const db = sqlitePath ?? join(dir, 'opsmitra.sqlite');
  if (fileExists) writeFileSync(db, 'existing database bytes');
  const result = spawnSync('sh', [join(server, 'docker-entrypoint.sh'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, SQLITE_PATH: db, STUB_LOG: log, STUB_DIR_WRITABLE: dirWritable ? '1' : '0', STUB_FILE_WRITABLE: fileWritable ? '1' : '0' }
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8') : '';
  const content = fileExists ? readFileSync(db, 'utf8') : null;
  rmSync(root, { recursive: true, force: true });
  return { ...result, calls, content, dir };
}

test('entrypoint: root + unwritable volume => fixes ownership of the data folder, then drops to the app user', { skip: !hasSh }, () => {
  const r = runEntrypoint({ dirWritable: false });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /fixing ownership/);
  assert.match(r.calls, /chown -R 1000:1000 .*data/);
  assert.match(r.calls, /exec-as-app echo started/);
  assert.match(r.stdout, /started/);
});

test('entrypoint: root + already-writable volume => no ownership change, still drops privileges', { skip: !hasSh }, () => {
  const r = runEntrypoint({ dirWritable: true });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /chown/);
  assert.match(r.calls, /exec-as-app/);
});

test('entrypoint: a root-owned existing database file is repaired in place, never replaced', { skip: !hasSh }, () => {
  const r = runEntrypoint({ dirWritable: true, fileExists: true, fileWritable: false });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.calls, /chown -R/);
  assert.equal(r.content, 'existing database bytes');
});

test('entrypoint: refuses to chown a dangerous location', { skip: !hasSh }, () => {
  const r = runEntrypoint({ dirWritable: false, sqlitePath: '/opsmitra.sqlite' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Refusing to change ownership/);
  assert.doesNotMatch(r.calls, /chown/);
});

test('entrypoint: when already unprivileged it just starts the app', { skip: !hasSh }, () => {
  const r = runEntrypoint({ uid: '1000', dirWritable: false });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.calls, /chown|exec-as-app/);
  assert.match(r.stdout, /started/);
});

test('Dockerfile starts the app through the entrypoint and no longer hard-codes the node user or a VOLUME', () => {
  const docker = readFileSync(join(server, 'Dockerfile'), 'utf8');
  assert.match(docker, /ENTRYPOINT \["\/usr\/local\/bin\/docker-entrypoint\.sh"\]/);
  assert.match(docker, /CMD \["node", "src\/index\.js"\]/);
  assert.doesNotMatch(docker, /^USER /m, 'the entrypoint drops privileges itself');
  assert.doesNotMatch(docker, /^VOLUME/m, 'Railway rejects VOLUME');
  assert.match(docker, /COPY docker-entrypoint\.sh/);
  assert.equal(readFileSync(join(server, 'docker-entrypoint.sh'), 'utf8').includes('\r'), false, 'entrypoint must use LF line endings');
});
