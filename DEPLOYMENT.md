# Deploying OpsMitra (Vercel web app + separate API host)

## Why two services

| Part | Where | Why |
|---|---|---|
| `client/` (React + Vite) | **Vercel** | Static files. Vercel is ideal. |
| `server/` (Express + **SQLite**) | **A host with a persistent disk** (Fly.io, Railway, Render, a VPS, or any Docker host) | The database is a SQLite file written by `better-sqlite3`. Vercel functions run on a read-only, temporary filesystem that is thrown away between invocations and cannot be shared between instances, so a SQLite database there would silently lose or fork your data. Moving to a hosted database (e.g. Postgres) would be a code rewrite and is **not** done here. |

The API must run as **one instance with a persistent volume**. SQLite does not support several servers sharing one file.

The browser only ever talks to your Vercel domain. Vercel forwards `/api/*` to the API host (a rewrite in `client/vercel.json`). That keeps the HttpOnly session cookie first-party, so login works without third-party-cookie problems and without CORS.

```
Browser ──https──> your-app.vercel.app ──/api/* rewrite──> https://api.yourhost.com  (SQLite on a volume)
```

## 1. Deploy the API first

You need a host that gives you: Node 20+ or Docker, a **persistent volume**, HTTPS, and a single instance. `server/Dockerfile` is ready (it stores data in `/data`; mount your volume there).

Set these environment variables on the API host:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | a new random string, 32+ characters (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). Never reuse your local one. |
| `SQLITE_PATH` | `/data/opsmitra.sqlite` (a path **on the persistent volume**) |
| `CLIENT_ORIGIN` | your Vercel URL exactly, e.g. `https://opsmitra.vercel.app` (no trailing slash; comma-separate several, e.g. a custom domain too) |
| `TRUST_PROXY_HOPS` | `2` (Vercel, then your host's proxy). If sign-in rate limiting seems to affect everyone at once, or nobody, adjust this. |
| `PROTOTYPE_RESET_LINKS` | `false`. (Required: with `true` anyone could reset any account's password from the on-screen link. Real password reset needs an email service, which this prototype does not have.) |
| `SERVE_CLIENT` | `false` |
| `ANTHROPIC_API_KEY` | optional: enables the Claude-powered assistant |

The API **refuses to start** in production if the secret is weak, the database path is not an absolute path, `CLIENT_ORIGIN` is missing or malformed, or reset links are exposed, and it says which setting to fix. Check `GET https://api.yourhost.com/api/health` returns `{"status":"ok", ... "integrity":"ok"}`.

Health-check path for your host: `/api/health`.

## 2. Deploy the web app on Vercel

1. Edit `client/vercel.json`: replace `https://YOUR-API-HOST.example.com/api/:path*` with `https://<your API host>/api/:path*` (keep `/api/:path*`, use `https`). Commit that change.
2. In Vercel: **Add New → Project →** import the repository.
3. **Root Directory: `client`**. Framework preset: Vite (detected). Build command and output directory are taken from `vercel.json` (`npm run vercel-build`, `dist`).
4. **Environment variables: none.** Do **not** set `VITE_API_BASE_URL`; the build stops if you do, because calling the API directly would make the session cookie third-party.
5. Deploy. The build **fails on purpose** if the placeholder host is still in `vercel.json`, so a half-configured site can't go live.
6. Update `CLIENT_ORIGIN` on the API host to the final Vercel URL (and your custom domain, if any), then restart the API.

## 3. Your data

- **Nothing is migrated or reset automatically.** A fresh production database starts empty (users register normally; "Try the live demo" creates isolated demo workspaces that expire after two days).
- To bring over your current local data, that is a deliberate step: stop the API, copy a **backup** of the local file onto the volume as `opsmitra.sqlite`, start the API (it upgrades the schema in place, never deleting rows). Do this only with your approval and with a backup of both sides.
- **Back up regularly:** `npm run backup --prefix server` (run on the API host, or `node server/scripts/backup-sqlite.js /path/on/volume`) writes a consistent, integrity-checked single-file copy while the app is running and never overwrites anything. Also enable your host's volume snapshots.
- Do **not** run more than one API instance, and don't deploy by wiping the volume.
- Demo accounts: if you don't want public one-click demos in production, don't link to them; they only ever see their own sample data.

## 4. Checklist after deploying

- [ ] `https://api.yourhost.com/api/health` is `ok`
- [ ] `https://your-app.vercel.app/api/health` is also `ok` (proves the rewrite works)
- [ ] Register, sign out, sign in, refresh a deep link like `/app/inventory` (must not 404)
- [ ] Restart the API on the host and confirm your data is still there
- [ ] The response `Set-Cookie` for sign-in shows `HttpOnly; Secure; SameSite=Strict`
- [ ] A backup file was produced and opens

## Known limitations / things to verify on your hosts

- Not tested on real Vercel or a real API host (no accounts here). The configuration was verified locally: production boot, config guards, secure cookies, the Vercel config guard, backups, and the full test suite.
- `TRUST_PROXY_HOPS` depends on the exact proxy chain. Confirm that two different people signing in from different networks are not rate-limited together.
- Long assistant answers go through two proxies; if you see timeouts, check your hosts' request time limits.
- Passwords can't be reset by email yet. Until an email service is added, a locked-out owner needs an operator to set a password.
- One instance only (SQLite). To scale beyond that you would need to move the data layer to a client/server database.
