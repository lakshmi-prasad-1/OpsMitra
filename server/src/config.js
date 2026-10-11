import { isAbsolute } from 'node:path';

/**
 * Production safety checks, run once at startup (never in tests or local development).
 * Returns { errors, warnings }. Errors stop the server: each one would otherwise cause silent data loss
 * or a security hole that is easy to miss on a hosting dashboard.
 */
export function checkProductionConfig(env = process.env) {
  const errors = [];
  const warnings = [];
  if (env.NODE_ENV !== 'production') return { errors, warnings };

  const secret = env.JWT_SECRET || '';
  if (secret.length < 32 || secret.startsWith('replace_with_')) errors.push('JWT_SECRET must be a random string of at least 32 characters.');

  if ((env.DB_DRIVER || 'sqlite').toLowerCase() !== 'sqlite') errors.push('DB_DRIVER must be "sqlite".');
  if (!env.SQLITE_PATH || !isAbsolute(env.SQLITE_PATH)) {
    if (env.ALLOW_EPHEMERAL_DB !== 'true') {
      errors.push('SQLITE_PATH must be an absolute path on a persistent disk or volume (for example /data/opsmitra.sqlite). Without it the database lives inside the app folder, which most hosts wipe on every deploy or restart. Set ALLOW_EPHEMERAL_DB=true only for a disposable test.');
    } else warnings.push('ALLOW_EPHEMERAL_DB=true: data will be lost when this instance is rebuilt or restarted.');
  }

  if (!env.CLIENT_ORIGIN) errors.push('CLIENT_ORIGIN must be set to the public URL of the web app (for example https://your-app.vercel.app).');
  else if (env.CLIENT_ORIGIN.split(',').some(o => !/^https?:\/\/[^/\s]+$/.test(o.trim()))) errors.push('CLIENT_ORIGIN must contain origins only (scheme and host, no path or trailing slash), comma separated.');

  if (env.PROTOTYPE_RESET_LINKS === 'true' && env.ALLOW_PUBLIC_RESET_LINKS !== 'true') {
    errors.push('PROTOTYPE_RESET_LINKS=true shows password-reset links on screen to anyone who knows an email address, which lets strangers take over accounts. Set it to false (or unset it). Set ALLOW_PUBLIC_RESET_LINKS=true only for a throw-away public demo.');
  }

  const hops = Number(env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(hops) || hops < 1) warnings.push('TRUST_PROXY_HOPS is 0: behind a hosting proxy every visitor will appear to share one IP, so sign-in rate limiting will lock everyone out together. Set it to the number of proxies in front of the API (2 for Vercel rewrite + host proxy).');
  if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_MODEL) warnings.push('ANTHROPIC_MODEL is not set; the default claude-opus-5-5 will be used.');
  return { errors, warnings };
}
