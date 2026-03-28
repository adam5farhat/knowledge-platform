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

5. **Web environment** (`apps/web/.env.local`)

   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3001
   ```

6. **Run dev servers**

   ```bash
   npm run dev
   ```

   - API: http://localhost:3001  
   - Web: http://localhost:3000  

7. **Sign in**  
   After seed, default admin is `admin@example.com` / `ChangeMe123!` unless overridden by `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev` | API + Web together |
| `npm run verify` | Production builds for API and Web |
| `npm run test:api` | Vitest (integration tests; needs DB + seed) |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed roles, departments, sample users |

## API build note

TypeScript compilation **excludes** `src/**/*.test.ts` so `npm run build` in the API package only compiles application code. Run `npm run test:api` for tests.

## License

Private project.
