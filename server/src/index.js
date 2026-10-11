import 'dotenv/config';
import { checkProductionConfig } from './config.js';

// Fail fast on an unsafe production configuration, before the database file is created or opened.
const { errors, warnings } = checkProductionConfig();
for (const warning of warnings) console.warn(`[config] warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[config] error: ${error}`);
  console.error('[config] Refusing to start. Fix the settings above (see DEPLOYMENT.md).');
  process.exit(1);
}

const { app } = await import('./app.js');
const { pool } = await import('./db.js');
const port = Number(process.env.PORT || 4000);
const server = app.listen(port, () => console.log(`OpsMitra API listening on port ${port}${process.env.NODE_ENV === 'production' ? ' (production)' : ''}`));

// Hosts send SIGTERM on every deploy/restart: finish in-flight requests, then close SQLite cleanly (checkpoints the WAL).
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received: shutting down`);
  const force = setTimeout(() => process.exit(1), 10000);
  force.unref();
  server.close(async () => {
    try { await pool.close(); } catch (error) { console.error('Error while closing the database:', error.message); }
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
