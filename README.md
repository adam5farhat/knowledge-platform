# Knowledge Platform

Monorepo: **API** (Express + Prisma + Postgres/pgvector + Redis/BullMQ) and **Web** (Next.js).

## Prerequisites

- Node.js 20+ (CI uses 22)
- Docker (for Postgres + Redis locally)

## Quick start

1. **Start infrastructure**

   ```bash
   npm run docker:up
   ```

2. **Install dependencies** (from repository root)

   ```bash
   npm install
   ```

3. **Database**

   Set `DATABASE_URL` in `apps/api/.env` (or export in shell), for example:

   ```env
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/knowledge_platform"
   ```

   Then:

   ```bash
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   ```

4. **API environment** (`apps/api/.env`)

   | Variable | Purpose |
   |----------|---------|
   | `JWT_SECRET` | Min 16 characters; **required** in production (process exits if missing). |
   | `OPENAI_API_KEY` | Embeddings + semantic search; ingest fails without it. |
   | `REDIS_URL` | Optional; defaults like `redis://127.0.0.1:6379` if unset. |
   | `STORAGE_PATH` | Optional; file uploads directory. |
   | `SMTP_*` | Optional; without `SMTP_HOST`, password reset emails are only logged in dev. |
   | `PUBLIC_API_URL` | **Recommended in all environments.** Public base URL of this API (`https://api.example.com`, no trailing slash). Used when saving profile-picture URLs so `<img src>` works behind proxies. **Must match** `NEXT_PUBLIC_API_URL` on the web app (same scheme + host). Local dev: `http://localhost:3001`. |

5. **Web environment** (`apps/web/.env.local`)

   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

   Use the **same** scheme + host as `PUBLIC_API_URL` in `apps/api/.env` so API calls and avatar image URLs stay consistent.

   **Production:** point both at the public API hostname, for example:

   ```env
   # apps/api/.env
   PUBLIC_API_URL=https://api.example.com

   # apps/web — build-time (e.g. hosting dashboard or .env.production)
   NEXT_PUBLIC_API_URL=https://api.example.com
   ```

6. **Run dev servers**

   ```bash
   npm run dev
   ```

   Optional: **Turbopack** for the Next.js dev server (faster refresh on some setups):

   ```bash
   npm run dev:turbo
   ```

   - API: http://localhost:3001  
   - Web: http://localhost:3000 (opens `/`: redirects to **Sign in** if logged out, or **Dashboard** if logged in)  

7. **Sign in**  
   After seed, default admin is `admin@example.com` / `ChangeMe123!` unless overridden by `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev` | API + Web together |
| `npm run dev:turbo` | Same as `dev`, with Next.js Turbopack (`NEXT_TURBOPACK_DEV=1`) |
| `npm run verify` | Production builds for API and Web |
| `npm run analyze:web` | Web production build with bundle analyzer (`ANALYZE=true`; inspect chunk sizes) |
| `npm run test:api` | Vitest (integration tests; needs DB + seed) |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed roles, departments, sample users |

## API build note

TypeScript compilation **excludes** `src/**/*.test.ts` so `npm run build` in the API package only compiles application code. Run `npm run test:api` for tests.

## Troubleshooting (web)

If the dashboard (or any page) loads but **`/_next/static/...` returns 404** for CSS or JS, the dev cache is usually out of sync with what the browser is asking for.

1. Stop **all** `node` / Next dev processes (only one app should use port 3000).
2. From the repo root: **`npm run dev:clean`** (stops Node, deletes `apps/web/.next`, starts dev again), or manually delete **`apps/web/.next`** and run **`npm run dev`**.
3. Hard-refresh the browser (**Ctrl+Shift+R**) or close old tabs that pointed at an earlier dev session.

Root **`npm run dev`** runs **`node scripts/dev-web.mjs`** and **`node scripts/dev-api.mjs`**, which **force `cwd`** to **`apps/web`** and **`apps/api`** so Next always reads/writes **`apps/web/.next`** (avoids `/_next/static/*` 404s when the dev server’s working directory is wrong). Those scripts also **align** **`PUBLIC_API_URL`** (API process) with **`NEXT_PUBLIC_API_URL`** (web process): if you only set one, both default to the other, then **`http://localhost:3001`**, so stored avatar URLs match what the browser uses for API calls during local development.

## License

Private project.
