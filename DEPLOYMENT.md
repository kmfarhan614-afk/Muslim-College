# Deployment guide

This project is **not a Next.js application**. The college system is a static
site (`*.html`, `css/`, `js/`, `assets/`) plus a single Node process
(`server.js`) that serves those files and exposes `/api/*`.

That has one important consequence:

> **A Vercel static deployment alone cannot run `server.js`.** It will render
> the pages but every `/api/*` call returns 404 and the app silently falls back
> to browser `localStorage`.

Choose one of the two supported architectures below and approve it before any
production deployment.

---

## Option A — Single Node host (recommended, simplest)

Host the whole repository on Render, Railway, Fly.io or a VPS.

| Setting | Value |
| --- | --- |
| Build command | none (`node server.js` needs no npm install) |
| Start command | `node server.js` |
| Health check | `/api/health` |
| Port | `PORT` (the host injects it) |
| Node version | 18+ (24 tested) |

Required environment variables:

```ini
NODE_ENV=production
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=<strong unique password>
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<secret>          # server-side only
```

`NODE_ENV=production` makes the server bind to `0.0.0.0` and refuses to boot
while `ADMIN_PASSWORD` is empty or `admin123`.

**Persistent storage:** most PaaS filesystems are ephemeral. The student
register, exams and teacher accounts live in `DATA_DIR` (default `./data`).
Attach a persistent disk/volume and point `DATA_DIR` at it:

```ini
DATA_DIR=/var/data
```

The optional `render.yaml` blueprint in the repository root creates exactly this
Render web service (1 GB disk at `/var/data`, `ADMIN_PASSWORD` / Supabase secrets
prompted on import). Render disks require the paid `starter` plan.

Supabase currently mirrors attendance records and academic sessions (and the
one-time `/api/sync` seed), **not every later student/exam edit**. Do not rely
on Supabase alone for the register until that migration is completed.

---

## Option B — Vercel static site + Node API on another host

Keep the pages on Vercel and run `server.js` on Render/Railway/Fly/VPS. Vercel
proxies `/api/*` to the backend so the browser still sees one origin (no CORS
changes needed).

The repository ships `vercel.json` and `.vercelignore` for this split:

1. Deploy `server.js` to the Node host first (Option A steps, persistent disk and
   all environment variables).
2. Replace **both** `https://YOUR-BACKEND.onrender.com` placeholders in
   `vercel.json` with that host. The API proxy will 404/502 until you do.
3. Import the repository into Vercel. `framework: null`, `buildCommand:
   "echo static-site"` and `outputDirectory: "."` keep Vercel from building the
   unused Next.js scaffold.
4. Verify `https://YOUR-SITE/api/health` returns JSON from the Node host.

`vercel.json` also mirrors the clean URLs that `server.js` serves
(`/admin`, `/super-admin`, `/teacher-login`, `/teacher-accounts`,
`/teacher-dashboard`, `/teachers`), so bookmarks work on both hosts.
`.vercelignore` keeps the scaffold, tests, `data/`, `server.js` and env files out
of the static upload.

Notes:

- Do not enable `cleanUrls`; the app links to `*.html` pages directly.
- Preview deployments will proxy to the same production backend. Use a separate
  backend/preview environment if you test destructive flows.
- Because `/api/*` is rewritten (not a serverless function), request bodies are
  not subject to Vercel's 4.5 MB function limit and headers/auth pass through.
- The Node host still needs a persistent volume and the environment variables
  from Option A.

A serverless-only Vercel deployment would require rewriting `server.js` to be
Supabase-first (no local filesystem). That is a separate project and is **not**
included here.

---

## Supabase

1. Run `supabase/migrations/20261029000000_initial_schema.sql` (identical to
   `supabase/schema.sql`) in the Supabase SQL Editor. It is idempotent and
   non-destructive.
2. Add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to the host environment.
3. Restart and confirm:

```powershell
curl https://YOUR-HOST/api/supabase/status
```

Expected: `configured: true`, `reachable: true`, `schemaReady: true`.
Then sign in as admin and run the one-time seed (`POST /api/sync`).

Never put the service-role key in a `NEXT_PUBLIC_*` variable or in client code.

## Release process

1. Work on a branch; never commit directly to `main`.
2. Run the full check locally:
   ```powershell
   node --check server.js
   npm test
   npm run lint
   ```
3. Push the branch, open a pull request, let the preview deployment run.
4. Review the diff and test the preview with real read-only data.
5. Merge to `main`, deploy, and record the commit SHA in the release notes.
6. Protect `main` and require review before merge.

## Rollback

- **Code:** redeploy the previous Vercel deployment, or
  `git revert <sha>` and merge; never force-push `main`.
- **Database:** schema changes are additive and versioned; apply a new migration
  instead of editing an old one. Do not run `DROP`/`DELETE` scripts on
  production without a verified backup.
- **Local state:** restore the timestamped archive under `data/backups/manual/`
  (created before any migration) or the server's per-key rotation in
  `data/backups/`.

## Post-deploy verification

- `/api/health` → `ok: true`
- `/api/supabase/status` → configured/reachable/schemaReady
- Admin sign-in, student search, attendance save, marks entry, DMC print
- Teacher sign-in with a real account and a class/subject the account owns
- Refresh a deep page (`/students.html?…`, `/examinations.html?tab=marks`)
- Confirm a new record survives a server restart (persistent disk) or is present
  in Supabase
