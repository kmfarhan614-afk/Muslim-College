# Muslim Commerce College Peshawar — College Management System

Attendance, student register, teacher portal, examinations and DMC management
for Muslim Commerce College Peshawar.

The running application is the **static site in the repository root** (`*.html`,
`css/`, `js/`) served by a **zero-dependency Node.js backend** (`server.js`).
Supabase Postgres is optional and provides durable cloud storage.

> The `app/`, `components/`, `services/`, `lib/` and `types/` folders are an
> unused Next.js scaffold. They are not the application. Do not run the college
> system with `next dev`/`next start`; run `node server.js`.

## Requirements

- Node.js 18 or newer (tested with Node 24)
- A modern browser
- Optional: a Supabase project (Project URL + keys) for permanent storage
- No npm dependencies are required to run the backend or the frontend

## Quick start (local)

```powershell
node server.js
```

Then open <http://localhost:3000>.

| Area | URL | Credentials |
| --- | --- | --- |
| Admin sign-in | `/` (`index.html`) | `admin@college.com` / `admin123` (local demo only) |
| Super Admin dashboard | `/admin.html` | same admin session |
| Teacher accounts | `/teacher-accounts.html` | same admin session |
| Teacher portal | `/teacher-login.html` | created by the Super Admin |

Other pages: `dashboard.html`, `students.html`, `attendance.html`,
`classes.html`, `teachers.html`, `examinations.html`, `reports.html`,
`planner.html`, `settings.html`.

`server.js` also accepts clean URLs such as `/admin`, `/super-admin`,
`/teacher-login` and redirects them to the matching `.html` page.

## Configuration

Copy `.env.example` to `.env.local` and fill in the values you need.
`server.js` loads `.env.local` itself; real environment variables always win.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Enable permanent Supabase storage (server-side only) |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Reused as fallbacks; never expose the secret key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Admin sign-in |
| `PORT` / `HOST` | Listen address (default `3000` / `127.0.0.1`, or `0.0.0.0` when `NODE_ENV=production`) |
| `DATA_DIR` | Override the runtime data directory (default `./data`) |
| `NODE_ENV` | Set to `production` on the deployed host |

### Production security guard

If `NODE_ENV=production` and `ADMIN_PASSWORD` is unset or still `admin123`,
`server.js` **refuses to start**. Set a strong password before deploying.

## Data storage

- Browser: `localStorage` keys prefixed `mca_` (students, attendance, exams, …).
- Server: `data/` (git-ignored)
  - `data/state/<key>.json` — server-side copy of the `mca_*` collections
  - `data/auth/users.json` — teacher accounts (scrypt hashes, audit trail)
  - `data/backups/` — rotating per-key backups and daily snapshots
- Supabase: optional durable copy (`/api/sync`, attendance and academic sessions).

Never commit `data/`, `.env.local`, database dumps or backups.

## Supabase (optional)

1. Run `supabase/schema.sql` (or `supabase/migrations/20261029000000_initial_schema.sql`)
   in the Supabase SQL Editor. It is idempotent.
2. Put the Project URL and the **service-role** key in `.env.local`.
3. Restart `node server.js` and check:

```powershell
curl http://localhost:3000/api/supabase/status
```

`configured`, `reachable` and `schemaReady` must all be `true`.

See [SUPABASE.md](SUPABASE.md) for the full schema, API routes, security model
and migration plan.

## Tests

```powershell
npm test
```

Runs the four harnesses in `tests/` (backend API + 10 000-student register,
teacher/Super Admin portal + RBAC, Sabih ud Din preset, and page wiring).
The vanilla app is also checked with `node --check` on every `js/*.js` file.

`npm run build` / `npm run lint` validate the unused Next.js scaffold only.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). The selected architecture is a Vercel static
site plus the Node API on a separate host (`vercel.json` proxies `/api/*`).
`render.yaml` is an optional Render blueprint with a persistent disk.

## Repository layout

```
*.html, css/, js/, assets/   live static application
server.js                    HTTP server, REST API, Supabase proxy
supabase/                    SQL schema and versioned migrations
tests/                       API / portal / wiring harnesses
data/                        runtime state (git-ignored)
app/, components/, services/ unused Next.js scaffold
muslim-commerce-attendance/  legacy mirror of the static app
```

The `muslim-commerce-attendance/` mirror must be kept byte-identical to the
root files it contains (or removed) to avoid editing the wrong copy.
