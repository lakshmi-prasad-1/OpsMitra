// Runs before `vite build` on Vercel (npm run vercel-build). Stops the deployment if the API proxy is not configured,
// so a half-configured site can never go live pointing at a placeholder host.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const onVercel = Boolean(process.env.VERCEL);
const config = JSON.parse(readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8'));
const problems = [];

const api = (config.rewrites || []).find(r => r.source.startsWith('/api/'));
if (!api) problems.push('client/vercel.json has no rewrite for /api/:path*.');
else {
  let url;
  try { url = new URL(api.destination.replace(':path*', 'x')); } catch { problems.push(`The /api rewrite destination is not a valid URL: ${api.destination}`); }
  if (url) {
    if (/YOUR-API-HOST/i.test(url.hostname)) problems.push('Edit client/vercel.json: replace YOUR-API-HOST.example.com in the /api rewrite with the hostname of your deployed OpsMitra API.');
    if (url.protocol !== 'https:') problems.push('The /api rewrite destination must use https:// so session cookies and passwords are never sent in clear text.');
    if (!url.pathname.startsWith('/api/')) problems.push('The /api rewrite destination must keep the /api/ prefix (…/api/:path*).');
  }
}
if (process.env.VITE_API_BASE_URL) problems.push('Remove the VITE_API_BASE_URL environment variable from the Vercel project. The app must call /api on its own domain (proxied by Vercel) or the session cookie will be treated as third-party and blocked.');

if (!problems.length) { console.log('Vercel configuration OK: /api is proxied to', api.destination.replace('/api/:path*', '')); process.exit(0); }
for (const problem of problems) console.error(`${onVercel ? 'ERROR' : 'WARNING'}: ${problem}`);
if (onVercel) { console.error('\nDeployment stopped. See DEPLOYMENT.md.'); process.exit(1); }
console.error('\n(Not on Vercel, so the local build continues.)');
