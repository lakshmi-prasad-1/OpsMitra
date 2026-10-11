// Starts the API (serving the built client) on a throwaway SQLite database, then runs the browser smoke test.
// Prerequisites: `npm run install:all`, `npm run build`, and once: `npx playwright install chromium`.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (!existsSync(join(root, 'client/dist/index.html'))) { console.error('client/dist is missing. Run "npm run build" first.'); process.exit(2); }

const port = process.env.E2E_PORT || '4180';
const dir = mkdtempSync(join(tmpdir(), 'opsmitra-e2e-'));
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: join(root, 'server'),
  env: { ...process.env, PORT: port, SQLITE_PATH: join(dir, 'e2e.sqlite'), JWT_SECRET: 'e2e-secret-e2e-secret-e2e-secret-1234567', CLIENT_ORIGIN: `http://localhost:${port}`, AUTH_MAX_ATTEMPTS: '100000', NODE_ENV: 'test', ANTHROPIC_API_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
const cleanup = () => { server.kill(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir still locked on Windows: harmless */ } };
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

const base = `http://localhost:${port}`;
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
  if (i === 49) { console.error(`Server did not start:\n${log}`); process.exit(2); }
  await new Promise(r => setTimeout(r, 200));
}
process.env.BASE = base;
await import('./smoke.mjs');
