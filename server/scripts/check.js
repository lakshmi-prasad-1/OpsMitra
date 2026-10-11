// Syntax-checks every server source, script and test file (replaces the old hand-maintained file list).
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function* walk(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) { if (name !== 'node_modules' && name !== 'data') yield* walk(path); }
    else if (name.endsWith('.js')) yield path;
  }
}
let count = 0;
for (const directory of ['src', 'scripts', 'test']) {
  for (const file of walk(join(root, directory))) { execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' }); count++; }
}
console.log(`Syntax OK: ${count} files`);
