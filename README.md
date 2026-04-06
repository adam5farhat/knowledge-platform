# Knowledge Platform

Enterprise **document library** and **AI-assisted Q&A** (RAG) for teams organized by **departments**, with **role-based access**, **administration**, and **manager** views.

This repository is the **integrated production-style codebase**: a TypeScript **monorepo** with a **REST + SSE API** (Express), a **Next.js 15** web app, **PostgreSQL + pgvector**, **Redis / BullMQ** for asynchronous document processing, and **Google Gemini** for embeddings, retrieval, reranking, and answer generation.

---

## Who this README is for

| Reader | What you will find here |
|--------|-------------------------|
| **Developers / maintainers** | Architecture, folder layout, how to run and build, env vars, API surface, data model, troubleshooting. |
| **Product / stakeholders** | What the platform does end-to-end, roles, major features, and how AI search fits in. |
| **DevOps** | Docker services, health checks, production notes, migration workflow. |

---

## Table of contents

1. [What this platform does](#what-this-platform-does)
2. [Final version: capabilities delivered](#final-version-capabilities-delivered)
3. [High-level architecture](#high-level-architecture)
4. [Technology stack](#technology-stack)
5. [Repository layout](#repository-layout)
6. [Features implemented (detailed)](#features-implemented-detailed)
7. [Security, access control, and departments](#security-access-control-and-departments)
8. [AI / RAG pipeline](#ai--rag-pipeline)
9. [Document ingest worker](#document-ingest-worker)
10. [Data model (overview)](#data-model-overview)
11. [Backend module reference (`apps/api/src/lib`)](#backend-module-reference-appsapisrclib)
12. [API reference (routes)](#api-reference-routes)
13. [Web application (routes)](#web-application-routes)
14. [Prerequisites](#prerequisites)
15. [Quick start](#quick-start)
16. [Environment variables](#environment-variables)
17. [Scripts (repository root)](#scripts-repository-root)
18. [Production deployment notes](#production-deployment-notes)
19. [Testing](#testing)
20. [Troubleshooting](#troubleshooting)
21. [License](#license)

---

## What this platform does

- **Central document store**: Upload and version documents (multiple formats), tag them, control visibility (org-wide, department-scoped, or private), archive, favorites, recents, and audit logging.
- **Semantic search & ask**: Users with permission can run **vector search** and a **hybrid RAG "ask"** flow over documents they are allowed to read, with **Server-Sent Events (SSE)** streaming (sources, tokens, optional correction), source citations, and optional **conversation history**.
- **Feedback loop**: Users can submit **thumbs up/down (and comments)** on assistant messages; the system can use **negative feedback patterns** to steer future answers (`feedbackMemory.ts`).
- **Organizational structure**: **Departments** support a **parent/child hierarchy**. Users have a **primary department** plus optional **multi-department access** with levels: `MEMBER`, `MANAGER`, `VIEWER`, including **inherited** access down the tree for managers and viewers where implemented in `departmentAccess.ts`.
- **Notifications**: **Automatic** notifications for document events and role/membership changes (department-scoped), plus **manual announcements** by admins and managers with optional file attachments. A **bell icon with live unread badge** appears on every page, with a slide-in panel for browsing, reading, and downloading attachments.
- **Administration**: User lifecycle, bulk restrictions, imports, avatars, department CRUD/merge, KPI-style stats, activity and document-audit views, exports, and **per-user department access** management.
- **Manager experience**: Managers see **all departments they manage** (from access records and role), member lists, and document oversight aligned with those scopes.

---

## Final version: capabilities delivered

The codebase reflects a **mature single product** rather than a minimal demo. The following are the **defining characteristics** of this version (as implemented in code and migrations):

- **Hybrid retrieval**: `/search/ask` combines **pgvector similarity** with **PostgreSQL full-text (BM25-style)** search, then **reciprocal rank fusion (RRF)** to merge rankings before LLM reranking.
- **Query understanding**: `queryOptimizer.ts` rewrites the user question (keywords, topic, multi-hop sub-queries when needed) before retrieval.
- **Reranking & confidence**: Chunks are **reranked with Gemini**; answers use a **confidence** level derived from chunk scores (`ragCompletion.ts`).
- **Streaming answers**: `/search/ask` responds as **SSE** with typed events: `sources`, `token`, optional `correction`, then `done`.
- **Post-answer quality pass**: After streaming, an optional **critique / correction** step can emit a `correction` event if the model proposes a materially better answer (`ragEvaluation.ts` integration in `search.ts`).
- **Conversations**: Persisted threads and messages with **sources** and **confidence** on assistant turns; title generation endpoint.
- **Answer feedback**: `AnswerFeedback` model (one rating per message per user flow) plus **stats** endpoint for analytics-style views.
- **Multi-department access**: `UserDepartmentAccess` junction table with **migration backfill** from legacy "single primary department" users; auth middleware attaches **`readableDepartmentIds`** and **`manageableDepartmentIds`** for consistent enforcement.
- **Embeddings**: **768-dimensional** vectors (see migration `switch_embedding_768`); HNSW-style vector index migration for performance.
- **Async ingest**: **BullMQ** worker embedded in the API process: extract → chunk → embed → persist chunks. Failed jobs are retained with a 7-day TTL and 500-count cap for debugging.
- **Notification system**: Automatic notifications on document lifecycle events (create, update, delete), role changes (manager assigned/removed), and member additions — all department-scoped. Admins and managers can also send **manual announcements** with optional **file attachments** (downloadable by recipients). The frontend features a **bell icon with live unread badge** (10-second polling + visibility-change detection), a **slide-in panel** with infinite scroll, detail modals, and an in-panel **send notification form** with attachment support.
- **Hardening**: Comprehensive security audit and fixes applied (see [Security](#security-access-control-and-departments) below), including rate limiting on all sensitive endpoints, **TTL cache** and **retry with backoff** for Gemini rate limits (`cache.ts`), coordinated **refresh token** handling in the web client to avoid double-refresh races, CSP headers, CSV injection protection, and timing-attack mitigations.

---

## High-level architecture

```mermaid
flowchart LR
  subgraph clients [Browser]
    Web[Next.js 15 App Router]
  end
  subgraph api [API]
    Express[Express HTTP]
    Auth[JWT + refresh sessions]
    Docs[Documents + storage]
    Search[Search / RAG]
    Conv[Conversations]
    Notif[Notifications]
  end
  subgraph data [Data and workers]
    PG[(PostgreSQL + pgvector)]
    Redis[(Redis)]
    Bull[BullMQ ingest worker]
    Disk[Local file storage]
  end
  subgraph ai [Google Gemini]
    Emb[Embeddings]
    Chat[Chat / optimize / rerank]
  end
  Web -->|REST + Bearer token| Express
  Express --> Auth
  Express --> Docs
  Express --> Search
  Express --> Conv
  Express --> Notif
  Notif --> PG
  Notif --> Disk
  Docs --> PG
  Docs --> Disk
  Search --> PG
  Search --> Emb
  Search --> Chat
  Conv --> PG
  Conv --> Chat
  Bull --> Redis
  Bull --> PG
  Bull --> Emb
```

- **Web** calls the **API** using `NEXT_PUBLIC_API_URL` (browser `fetch`). Access tokens are held **in-memory** (never persisted to localStorage); refresh tokens are stored in **HttpOnly, Secure, SameSite=Lax cookies** (`kp_rt`, path `/auth`). Refresh uses a **single in-flight** promise so parallel requests do not invalidate rotated refresh tokens.
- **Document ingest** is processed by a **BullMQ consumer** started from `apps/api/src/index.ts` after the HTTP server listens.

---

## Technology stack

| Layer | Technology |
|--------|------------|
| **Web** | Next.js 15, React 19, TypeScript, App Router, CSS modules |
| **API** | Node.js, Express 4, TypeScript (ESM), Zod validation, `AppError` structured errors |
| **Database** | PostgreSQL 16 + **pgvector** (Prisma ORM) |
| **Cache / queue** | Redis 7, BullMQ |
| **Auth** | JWT access tokens (HS256, 15-minute default TTL) in-memory; refresh tokens in **HttpOnly cookies**; `authVersion` invalidation on password/role/email changes; **session cap** (10 per user) |
| **Security** | Helmet (CSP), frontend CSP via Next.js headers, CORS origin validation, rate limiting, bcrypt-12, password complexity rules (10+ chars, mixed case, digit, special), timing-attack mitigations, CSV injection protection |
| **AI** | **Google Gemini** (`@google/generative-ai`): embeddings (768-dim), query optimization, chunk reranking, streaming answers |
| **Files** | Multer uploads, configurable `STORAGE_PATH`, text extraction (PDF, Office, spreadsheets, etc. — see `extractText.ts`) |
| **Email** | Nodemailer with TLS enforcement (optional SMTP; dev logs reset links if SMTP unset) |
| **DevOps** | Multi-stage **Dockerfiles** (API + Web), full-stack **docker-compose**, **GitHub Actions CI** (lint, typecheck, test), structured **JSON logger** in production |
| **UX** | Toast notifications, confirm dialogs, shared spinner, accessible search with responsive CSS, **real-time notification system** with polling, downloadable attachments |

> **Note:** The API `package.json` lists an `openai` dependency for tooling compatibility, but **runtime RAG and embeddings use Gemini**. Configure **`GEMINI_API_KEY`** for ingest and ask flows.

---

## Repository layout

```
finalproject/
├── apps/
│   ├── api/                 # Express API, Prisma schema & migrations, ingest worker
│   │   ├── Dockerfile       # Multi-stage production image
│   │   ├── prisma/          # schema.prisma, migrations/, seed.ts
│   │   └── src/
│   │       ├── routes/      # auth, admin, manager, documents, search, conversations, notifications, avatars
│   │       ├── middleware/  # auth, per-feature restrictions
│   │       ├── lib/         # config, AppError, logger, schemas, access control, RAG, storage, email…
│   │       └── jobs/        # documentIngest (BullMQ consumer)
│   └── web/                 # Next.js frontend
│       ├── Dockerfile       # Multi-stage production image
│       ├── app/             # App Router pages (dashboard, documents, ask, admin, manager, …)
│       ├── components/      # Toast, ConfirmDialog, Spinner, Notifications, Providers, avatars, file icons…
│       └── lib/             # apiBase, authClient, restrictions helpers, profile URLs
├── .dockerignore            # Keeps Docker build context lean
├── .github/workflows/       # CI pipeline (lint, typecheck, test)
├── scripts/                 # dev-api.mjs, dev-web.mjs, clean-web-next.mjs
├── docker-compose.yml       # Postgres + Redis + API + Web (full stack)
└── package.json             # workspaces + root scripts
```

---

## Features implemented (detailed)

### Authentication and session

- Login, logout, **refresh** with **single-flight** refresh to avoid token rotation conflicts.
- Access tokens held **in-memory** (never in localStorage); refresh tokens stored in **HttpOnly, Secure, SameSite=Lax cookies**.
- **Password complexity**: minimum 10 characters, must include uppercase, lowercase, digit, and special character (enforced by shared `passwordPolicy.ts`).
- **Session cap**: maximum 10 concurrent sessions per user; oldest session auto-revoked when exceeded.
- **Password reset** (email with TLS enforcement, or dev console log when SMTP is unset).
- **Change password** blocks same-password reuse, bumps `authVersion` and syncs refresh sessions.
- **Profile** updates (badge, profile picture restricted to platform-hosted URLs, etc.).
- **Account restriction** flags (`loginAllowed`, document/dashboard/AI feature toggles).
- **Timing-attack mitigations**: dummy bcrypt on invalid-email login, normalized response time on forgot-password.

### Document library

- Upload documents and **new versions**; processing lifecycle (`PENDING` → `PROCESSING` → `READY` / `FAILED`) with progress where supported.
- **Visibility**: `ALL`, `DEPARTMENT`, `PRIVATE` enforced server-side via `documentAccess.ts`, `documentQuery.ts`, and JWT-enriched **readable department IDs**.
- **Tags**, **favorites**, **recents**, **archive**, **delete** (permission-checked).
- **Audit log** of document events (admin UI + CSV export with formula-injection protection).

### Search and AI

- **POST `/search/semantic`**: Vector search over embedded chunks (with access filters).
- **POST `/search/ask`**: Full pipeline — optimize query → parallel vector + BM25 → RRF → optional multi-hop retrieval → rerank → SSE stream → optional critique/correct (see [API reference](#api-reference-routes)).
- **Rate limiting** on the ask endpoint (applied after authentication to prevent unauthenticated IP exhaustion).
- **TTL cache** and **retry with backoff** for provider rate limits.

### Conversations

- List/create/update/delete conversations; append messages; **generate title**.
- **Feedback** on assistant messages (rating + optional comment); **feedback stats** endpoint.
- **Feedback memory** pulls recent negative patterns into the ask prompt when relevant.

### Admin

- Departments: CRUD, **merge** (transactional), hierarchy (`parentDepartmentId`). Delete is wrapped in a serializable transaction with usage checks.
- Users: create/update/delete, **bulk restrictions**, CSV **import**, avatar upload, lock/unlock, restore soft-deleted, revoke sessions, set password.
- **Last-admin safety**: admin role removal and user deletion are protected by serializable transactions that atomically verify at least one admin remains.
- **Department access** (per user): `GET` / `POST` / `DELETE` / `PUT` under `/admin/users/:userId/department-access`, plus **department-centric** `GET /admin/departments/:departmentId/access`.
- Stats, KPI time series, **activity** and **document audit** lists and CSV exports (with CSV formula-injection escaping).

### Manager

- **GET `/manager/departments`**: Departments the user may manage.
- **GET `/manager/department`**: Detail for a selected managed department (query `departmentId`), including members.

### Notification system

The platform includes a **full notification system** with both automatic (event-driven) and manual (admin/manager-authored) notifications.

#### Automatic notifications

Triggered server-side on key actions — recipients are scoped to the relevant department:

| Event | Helper | Scope |
|-------|--------|-------|
| Document created | `notifyDocumentCreated` | Department members |
| Document updated | `notifyDocumentUpdated` | Department members |
| Document deleted | `notifyDocumentDeleted` | Department members |
| Manager assigned | `notifyManagerAssigned` | Target user |
| Manager removed | `notifyManagerRemoved` | Target user |
| Member added | `notifyMemberAdded` | Target user |

All automatic notification calls are fire-and-forget (`.catch(err => logger.error(...))`) so they never block the primary operation.

#### Manual notifications (announcements)

Admins and managers can send manual notifications with:

- **Target audience**: All users, a specific department, or a specific role (admin-only for role/all targets; managers limited to their managed departments).
- **Attachments**: Optional file upload (images, PDF, Office, CSV, text — 10 MB limit, MIME allowlist enforced). Attachments are stored server-side and served through an authenticated download endpoint.
- **Recipient resolution**: Filters for active, non-deleted users. Department targeting includes both primary department members and users with `UserDepartmentAccess` records.

#### Real-time bell icon and notification panel

- **Bell icon** (`NotificationBell`): Appears in the navigation bar of every page. Displays an **unread count badge** that updates via polling (every 10 seconds) and on tab focus (`visibilitychange` event).
- **Slide-in panel** (`NotificationPanel`): Lists all notifications with infinite scroll pagination, mark-as-read on click, "Mark all read" bulk action, and per-item delete.
- **Detail modal**: Opens on click with full notification body, sender info, timestamp, human-readable type label (e.g. "Announcement" instead of "MANUAL"), and a **download button** for attachments (uses authenticated `fetchWithAuth` + blob download).
- **Send modal** (`SendNotificationModal`): In-panel form for admins/managers to compose and send notifications with file attachments. Escape key handling and outside-click isolation prevent accidental panel closure.

### Web UX

- Role-aware **home routing** (`homePathForUser` in `lib/restrictions.ts`).
- **Dashboard** with a 2×2 card grid (Documents, Ask, Department overview, Administration — shown based on role/permissions).
- **Documents** browser, **search** (with responsive CSS and full accessibility), **Ask** (RAG UI with markdown rendering, link sanitization via `rel="noopener noreferrer nofollow"`), **profile**, **restricted** explanation page.
- **Admin** hub (users, departments, documents, activity, audit, system) and **manager** dashboard with shared chrome.
- **Toast notifications**: context-based system replacing all native `alert()` calls — supports info, success, error, and warning types with slide-in/out animations and auto-dismiss.
- **Confirm dialogs**: promise-based component replacing all native `confirm()` calls — with keyboard support (Escape), focus management, danger mode styling, and `aria-modal` accessibility.
- **Shared Spinner**: SVG-animated loading indicator with `role="status"` and configurable size.
- **Error boundaries** (`error.tsx`, `global-error.tsx`) with Home link pointing to `/dashboard`.

---

## Security, access control, and departments

### Authentication hardening

| Control | Implementation |
|---------|----------------|
| **JWT signing** | HS256 algorithm pinned explicitly; secret minimum **32 characters** enforced at startup |
| **Access token TTL** | Default **15 minutes** (configurable via `JWT_EXPIRES_IN`); short-lived to limit stolen-token exposure |
| **Access token storage** | Held **in-memory only** (never persisted to localStorage or cookies) |
| **Refresh tokens** | **HttpOnly, Secure, SameSite=Lax cookies** (`kp_rt`, path `/auth`); 30-day TTL, atomic rotation (old token revoked in same transaction), replay detection |
| **Session cap** | Maximum **10** concurrent sessions per user; oldest session auto-revoked on overflow |
| **Password policy** | Minimum 10 characters; must include uppercase, lowercase, digit, and special character (shared `passwordPolicy.ts`) |
| **`authVersion`** | Incremented on password change, email change, role change, restriction change — instantly invalidates all existing tokens |
| **Password hashing** | bcrypt with 12 rounds, automatic salt |
| **Timing attacks** | Dummy bcrypt on invalid-email login; minimum 500ms + random jitter on forgot-password regardless of email existence |
| **Same-password block** | `/change-password` rejects `newPassword === currentPassword` |

### Rate limiting

| Endpoint | Limit |
|----------|-------|
| `/auth/login` | 15 / 15 min / IP |
| `/auth/refresh` | 30 / 15 min / IP |
| `/auth/forgot-password` | 8 / hour / IP |
| `/auth/reset-password` | 10 / 15 min / IP |
| `/search/ask` | 12 / min / IP (applied after authentication) |

### Transport and headers

- **API Helmet** with restrictive **Content-Security-Policy** (`default-src 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`).
- **Frontend CSP** via `next.config.ts` headers: `script-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https: <api>`, `connect-src 'self' <api>`, `frame-ancestors 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- **CORS**: strict origin validation from `WEB_APP_URL`; production denies all origins if `WEB_APP_URL` is unset.
- **SMTP TLS**: `requireTLS: true` enforced on the nodemailer transporter when not using implicit TLS.

### Access control

1. **JWT** carries user id, email, role, primary `departmentId`, and `authVersion`. `authenticateToken` loads the live user from DB on every request, rejects stale tokens with `ACCESS_TOKEN_OUTDATED` if email/role/department have changed, and computes:
   - **`readableDepartmentIds`** — departments whose documents the user may read (multi-department rows + hierarchy rules in `departmentAccess.ts`, cached with 30s TTL).
   - **`manageableDepartmentIds`** — departments the user may manage (for example `MANAGER` access on a parent can extend to descendants per helper logic).

2. **`documentAccess.ts`** enforces read/manage rules combining **visibility** with those ID sets (and **private** documents for the owner). `canViewAudit` is derived from management permissions rather than hardcoded.

3. **`restrictions.ts`** gates routes (for example document library vs AI) using `accessDocumentsAllowed`, `useAiQueriesAllowed`, etc.

4. **Roles**: `ADMIN`, `MANAGER`, `EMPLOYEE` (`RoleName` in Prisma). Admin routes require admin; manager routes require manager or department-level MANAGER access.

5. **Input validation**: All request bodies validated with **Zod schemas** (shared via `schemas.ts`); failures throw `AppError.badRequest` with structured `details` from `parsed.error.flatten()`. Explicit field mapping to Prisma updates (no raw `req.body` spread — prevents mass assignment).

6. **SQL injection prevention**: All raw queries use Prisma's `$queryRaw` tagged templates with parameterized values. The one `$executeRawUnsafe` usage (pgvector chunk insertion) uses positional bind parameters.

### Data protection

- **Profile picture URLs** restricted to platform-hosted `/avatars/{userId}/...` paths only (blocks arbitrary external URLs / tracking pixels / SSRF).
- **CSV export** escapes formula-injection prefixes (`=`, `+`, `-`, `@`, `\t`, `\r`) on all admin exports.
- **Avatar uploads** validated with MIME allowlist + magic-byte sniffing + 2MB size limit.
- **Document uploads** validated with MIME allowlist + 50MB size limit.
- **Notification attachments** validated with a strict MIME allowlist (images, PDF, Office, text/csv) + 10MB size limit; served only to authenticated recipients via streaming download endpoint.
- **Client-side avatar processing** enforces a 25MB file size limit before `createImageBitmap`.
- **PDF OCR fallback** enforces a 20MB size limit before sending to Gemini.
- **Markdown links** rendered with `target="_blank" rel="noopener noreferrer nofollow"` in the Ask UI.
- **Error handler** only leaks debug messages in non-production environments (`NODE_ENV !== "production"`).

---

## AI / RAG pipeline

1. **Ingest** (worker): File from disk → **extract** plain text (`extractText.ts`) → **chunk** (`chunkText.ts`) → **embed** with Gemini (`embeddings.ts`, 768 dims) → store in `DocumentChunk` with vector + optional full-text (`tsvector` per migrations).
2. **Ask** (`POST /search/ask`): Authenticated user → **optimize query** (`queryOptimizer.ts`) → **parallel** vector + BM25 (`search.ts`, `runBM25Search`) → **RRF** fusion → optional **multi-hop** extra vector passes → **rerank** (`reranker.ts`) → **confidence** (`assessConfidence`) → **SSE**: `sources` event, then streamed `token` events, optional **`correction`** event, then `done`.
3. **Feedback memory**: Before generation, recent **negative** feedback "lessons" can be appended to the prompt (`feedbackMemory.ts`).
4. **Utilities**: `cache.ts` (`TtlCache` with proactive expired-entry eviction, `withRetry` with configurable timeout). `ragEvaluation.ts` supports **critique/correct** flows invoked from the ask route.

---

## Document ingest worker

- **Started** in `apps/api/src/index.ts` via `startDocumentIngestWorker()` after `app.listen` (same Node process as the API).
- **Queue**: BullMQ uses Redis (`redisBull.ts`); jobs are produced when new versions need processing (see `documentIngest.ts` and document routes).
- **Pipeline**: Load file → extract text → chunk → batch embed → write `DocumentChunk` rows → update version/document status.
- **Failed jobs**: Retained with a 7-day TTL and 500-count cap (`removeOnFail`) for debugging; completed jobs retain the latest 1,000.
- **Shutdown**: `SIGINT` / `SIGTERM` stop the worker gracefully (`stopDocumentIngestWorker`) before closing HTTP and Prisma.

---

## Data model (overview)

Key Prisma models (see `apps/api/prisma/schema.prisma`):

| Area | Models |
|------|--------|
| **Identity** | `User`, `Role`, `Department` (self-relation for hierarchy) |
| **Access** | `UserDepartmentAccess` (user ↔ department with `DepartmentAccessLevel`) |
| **Documents** | `Document`, `DocumentVersion`, `DocumentChunk` (embedding + optional `tsvector`) |
| **Library** | `DocumentTag`, `DocumentUserFavorite`, `DocumentUserRecent`, `DocumentAuditLog` |
| **AI chat** | `Conversation`, `ConversationMessage`, `AnswerFeedback` |
| **Notifications** | `Notification` (type, title, body, actor, target, attachment fields), `UserNotification` (per-recipient read state) |
| **Auth** | `RefreshSession`, `AuthEvent`, `PasswordResetToken` |

Migrations under `apps/api/prisma/migrations/` include: pgvector enablement, auth/RBAC, documents, tags, refresh sessions, library extensions, audit, hybrid search, conversations, answer feedback, user-department access (with **data backfill**), embedding dimension change, vector index tuning, **notifications**, and **notification document FK**.

---

## Backend module reference (`apps/api/src/lib`)

| Module | Role |
|--------|------|
| `config.ts` | **Centralized configuration** — typed, validated env vars; single source of truth (no `process.env` elsewhere) |
| `AppError.ts` | **Structured error class** with `status`, `code`, `details`; static factories (`badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`); caught by global error handler |
| `logger.ts` | **Structured logger** — JSON to stdout/stderr in production, human-readable `[LEVEL] message` in dev; debug suppressed in production |
| `schemas.ts` | **Shared Zod schemas** (`bulkIdsSchema`, `chatRoleEnum`) used across routes |
| `passwordPolicy.ts` | Shared password complexity rules (min 10 chars, mixed case, digit, special) |
| `validation.ts` | `parseBody` helper — validates with Zod and throws `AppError.badRequest` on failure |
| `prisma.ts` | Prisma client singleton |
| `jwt.ts` / `refreshToken.ts` / `refreshCookie.ts` | Tokens (HS256, 32-char min secret, 15m default TTL), HttpOnly cookie helpers, session invalidation |
| `password.ts` / `passwordReset.ts` | bcrypt-12 hashing and reset token generation (256-bit entropy, SHA-256 stored) |
| `documentAccess.ts` / `documentQuery.ts` | Read/list rules and query builders |
| `departmentAccess.ts` | Readable / manageable department sets with hierarchy (30s TTL cache, cycle-safe) |
| `platformRoles.ts` | Centralized role checks (`isGlobalManagerRole`, `isPlatformAdmin`) |
| `userRestrictions.ts` / `mapUser.ts` | Restriction flags and API DTO shaping |
| `storage.ts` / `avatar.ts` / `avatarOps.ts` | File storage, avatar rules (platform-hosted URLs only), path traversal protection |
| `extractText.ts` / `chunkText.ts` | Ingest text pipeline (PDF/Office/spreadsheet extraction, 20MB OCR limit) |
| `embeddings.ts` | Gemini embeddings (768-dim, empty-result guard) |
| `queryOptimizer.ts` / `reranker.ts` / `ragCompletion.ts` | RAG orchestration with timeout protection |
| `ragEvaluation.ts` | Critique / correct (used from search route) |
| `feedbackMemory.ts` | Negative-feedback lessons for prompts |
| `cache.ts` | TTL cache (proactive expired-entry eviction) + `withRetry` with 30s timeout |
| `rateLimiter.ts` | Express rate limits (login, refresh, reset-password, forgot-password, ask) |
| `authErrorCodes.ts` | Custom error codes for explicit client-side handling |
| `clientIp.ts` | Safe client IP extraction with IPv4-mapped handling |
| `notificationService.ts` | **Notification creation and recipient resolution** — `createNotification` with target types (`allUsers`, `department`, `role`, `userIds`), convenience helpers (`notifyDocumentCreated`, `notifyManagerAssigned`, etc.); filters inactive/deleted users |
| `managerDashboard.ts` | Manager dashboard field resolution |
| `documentAudit.ts` / `tags.ts` | Audit logging and tags |
| `email.ts` | Nodemailer with TLS enforcement |
| `redis.ts` / `redisBull.ts` | Redis (with error listener) and BullMQ |

---

## API reference (routes)

Base URL (local): `http://localhost:3001`

Authenticated JSON APIs use `Authorization: Bearer <access_token>` unless noted.

| Prefix | Purpose |
|--------|---------|
| `GET /` | Service probe JSON |
| `GET /health` | Database + Redis checks (`ok` / `degraded`) |
| `/auth/*` | Login, refresh, me, profile, password, logout, forgot/reset password |
| `/admin/*` | Admin-only: users, departments, stats, KPIs, activity, document audit, exports, **department access** |
| `/manager/*` | Manager-only: list managed departments, department detail + members |
| `/documents/*` | Library CRUD, versions, tags, favorites, upload, download, audit triggers |
| `/search/*` | `POST /search/semantic`, `POST /search/ask` (SSE) |
| `/conversations/*` | Conversations, messages, feedback, title generation, feedback stats |
| `/notifications/*` | Notification list, unread count, mark read, send manual, attachment download, delete |
| `/avatars/*` | Public avatar file delivery |

### Admin: department access (multi-department)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users/:userId/department-access` | List access rows for a user |
| `POST` | `/admin/users/:userId/department-access` | Upsert one department assignment (`MEMBER` / `MANAGER` / `VIEWER`) |
| `PUT` | `/admin/users/:userId/department-access` | Replace **all** assignments for a user (bulk body) |
| `DELETE` | `/admin/users/:userId/department-access/:departmentId` | Remove one assignment |
| `GET` | `/admin/departments/:departmentId/access` | List users with access to a department |

### Notifications

All notification endpoints require authentication (`Authorization: Bearer <access_token>`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/notifications?page=1&limit=20` | Paginated list of notifications for the current user, including actor details and attachment metadata |
| `GET` | `/notifications/unread-count` | Returns `{ unreadCount: number }` — used by the bell icon poll |
| `PATCH` | `/notifications/:id/read` | Mark a single notification as read |
| `PATCH` | `/notifications/read-all` | Mark all of the current user's notifications as read |
| `POST` | `/notifications/send` | Send a manual notification (Admin/Manager only). Accepts `multipart/form-data` with `title`, `body`, `targetType` (`ALL_USERS` / `DEPARTMENT` / `ROLE`), optional `targetDepartmentId`, `targetRoleName`, and `attachment` file. Returns `201` with `notificationId`, or `200` with `notificationId: null` if no eligible recipients |
| `GET` | `/notifications/:notificationId/attachment` | Download the attachment file for a notification (only if the user is a recipient). Streams the file with correct `Content-Type` and `Content-Disposition: attachment` headers |
| `DELETE` | `/notifications/:id` | Delete a notification from the current user's list |

### Search: `POST /search/ask` (SSE)

Response `Content-Type: ` `text/event-stream`.

| Event | Payload (conceptually) |
|-------|-------------------------|
| `sources` | Retrieved chunks as citations + `confidence` |
| `token` | `{ token: string }` streamed answer fragments |
| `correction` | Optional improved answer + issue metadata after critique |
| `done` | Stream complete |

The web **Ask** client consumes these events to render streaming markdown and sources.

---

## Web application (routes)

| Route | Description |
|-------|-------------|
| `/` | Client gate: anonymous → `/login`; signed-in → role-appropriate home (`HomeEntryClient`) |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | Auth flows |
| `/dashboard` | Main dashboard — 2×2 card grid (Documents, Ask, Department overview, Administration) based on role |
| `/documents`, `/documents/search`, `/documents/ask`, `/documents/[id]` | Library, search, RAG chat, detail |
| `/profile` | Profile |
| `/manager` | Manager dashboard |
| `/admin`, `/admin/users`, `/admin/departments`, `/admin/documents`, `/admin/activity`, `/admin/document-audit`, `/admin/system` | Admin modules |
| `/restricted` | Explains blocked features when restrictions apply |

`apps/web/middleware.ts` (development only) sets **no-store** cache headers on HTML navigations to reduce stale `/_next/static` references after cleaning `.next`.

---

## Prerequisites

- **Node.js** 20+ (CI commonly uses 22)
- **Docker** (recommended) for Postgres + Redis locally
- **Google Gemini API key** for embeddings, search, and chat in normal use

---

## Quick start

### 1. Start infrastructure

```bash
npm run docker:up
```

This starts **PostgreSQL (pgvector)** and **Redis** (see `docker-compose.yml`). The compose file also defines `api` and `web` services for full-stack Docker deployment (see [Production deployment notes](#production-deployment-notes)).

### 2. Install dependencies (repository root)

```bash
npm install
```

### 3. Database

Set `DATABASE_URL` in `apps/api/.env` (see [Environment variables](#environment-variables)), then:

```bash
npm run db:generate
npm run db:migrate
npm run db:seed
```

### 4. Configure API and web env files

- Copy `apps/api/.env.example` → `apps/api/.env` and set at least **`JWT_SECRET`** (≥ 32 characters, generate with `openssl rand -hex 32`) and **`GEMINI_API_KEY`**.
- Copy `apps/web/.env.example` → `apps/web/.env.local` and set **`NEXT_PUBLIC_API_URL`** (for example `http://localhost:3001`).

**`PUBLIC_API_URL` (API)** and **`NEXT_PUBLIC_API_URL` (web)** should use the **same scheme + host** as the browser will use, so avatar URLs and API calls stay consistent.

### 5. Run development servers

```bash
npm run dev
```

- **API:** http://localhost:3001  
- **Web:** http://localhost:3000  

Root `npm run dev` runs `scripts/dev-api.mjs` and `scripts/dev-web.mjs`, which set **cwd** to `apps/api` and `apps/web` and align default public API URL values.

### 6. Sign in

After seed, the default admin is typically **`admin@example.com`** / **`ChangeMe123!`** unless overridden by `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `apps/api/.env`.

Optional **Turbopack** (can differ on Windows):

```bash
npm run dev:turbo
```

---

## Environment variables

### API (`apps/api/.env`)

| Variable | Required / typical | Purpose |
|----------|-------------------|---------|
| `DATABASE_URL` | Required | PostgreSQL connection string |
| `JWT_SECRET` | Required (min 32 chars) | Signing access tokens (HS256). Generate with `openssl rand -hex 32` |
| `JWT_EXPIRES_IN` | Optional | Access token TTL. Default `15m`. Accepts any `ms`-compatible string (e.g. `15m`, `1h`) |
| `GEMINI_API_KEY` | Required for ingest + RAG | Embeddings, optimization, rerank, answers |
| `GEMINI_EMBEDDING_MODEL` | Optional | Default `gemini-embedding-001` |
| `GEMINI_CHAT_MODEL` | Optional | Default `gemini-2.5-flash` |
| `REDIS_URL` | Optional | Defaults toward local Redis; BullMQ + health |
| `PORT` | Optional | Default `3001` |
| `PUBLIC_API_URL` | Strongly recommended | Public base URL of API (no trailing slash); align with web |
| `WEB_APP_URL` | Recommended in production | Web origin for CORS and password-reset links. If unset in production, CORS denies all cross-origin requests |
| `TRUST_PROXY` | Optional | Set to hop count (e.g. `1`) or subnet behind a reverse proxy. Avoid `true` in production |
| `STORAGE_PATH` | Optional | Upload directory |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional | If unset in dev, password reset links log to console. TLS is enforced when `SMTP_SECURE` is not `true` (STARTTLS upgrade) |
| `SEED_*` | Optional | Seed script overrides |

See `apps/api/.env.example` for the full list and inline comments.

### Web (`apps/web/.env.local`)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_API_URL` | Browser-visible API base URL (no trailing slash) |

---

## Scripts (repository root)

| Script | Description |
|--------|-------------|
| `npm run dev` | API + web together (Webpack dev server for Next by default) |
| `npm run dev:turbo` | Same with Next Turbopack (`NEXT_TURBOPACK_DEV=1`) |
| `npm run dev:api` / `npm run dev:web` | One side only |
| `npm run dev:clean` | Clean Next cache then `dev` |
| `npm run clean:web` | Remove `apps/web/.next` |
| `npm run build` / `npm run verify` | Production builds (API `tsc`, web `next build`) |
| `npm run test:api` | Vitest integration tests (needs DB + migrated schema) |
| `npm run db:migrate` | `prisma migrate deploy` in API workspace |
| `npm run db:generate` | `prisma generate` |
| `npm run db:seed` | Seed roles, departments, sample users |
| `npm run docker:up` / `docker:down` | Compose Postgres + Redis (dev infra); full `docker compose up --build` also builds API + Web images |

API **`npm run build`** excludes `*.test.ts` from `tsc` output; tests run with **`npm run test:api`**.

---

## Production deployment notes

### Option A: Docker (recommended)

The repository includes multi-stage **Dockerfiles** for both services and a full-stack `docker-compose.yml`:

```bash
# Build and start all services (Postgres, Redis, API, Web)
docker compose up -d --build
```

The compose file passes `NEXT_PUBLIC_API_URL` and `PUBLIC_API_URL` as build args for the web image. Override environment variables for production:

```yaml
api:
  environment:
    DATABASE_URL: postgresql://user:pass@db-host:5432/knowledge_platform
    REDIS_URL: redis://redis-host:6379
    JWT_SECRET: <your-secret-here>   # ≥ 32 chars
    GEMINI_API_KEY: <your-key>
    WEB_APP_URL: https://your-domain.com
```

The API image includes a **health check** (`GET /health`) with 30-second intervals.

### Option B: Manual deployment

- Set strong **`JWT_SECRET`** (minimum 32 characters, generated with `openssl rand -hex 32`), production **`DATABASE_URL`**, **`REDIS_URL`**, **`GEMINI_API_KEY`**, and **`PUBLIC_API_URL`** / **`NEXT_PUBLIC_API_URL`** to real public hostnames as appropriate.
- Set **`WEB_APP_URL`** to the production web origin — CORS will deny all cross-origin requests if this is unset in production.
- Set **`TRUST_PROXY`** to your reverse proxy hop count or subnet (e.g. `1` or `"loopback"`). Avoid `true` as it trusts all `X-Forwarded-For` headers unconditionally.
- Run **`npm run db:migrate`** against the production database before rolling out API versions that change schema.
- Build and serve **web** with `next build` + `next start` (or your host's equivalent).
- Run **API** with `node dist/index.js` after `npm run build` in `apps/api`.

### General

- **One listener per port**: only one process on the web port and one on the API port.
- Ensure **`NODE_ENV=production`** is set — this enforces the JWT_SECRET minimum at startup, enables JSON-structured logging, and suppresses debug error messages in API responses.
- Consider adding **SSL/TLS termination** via a reverse proxy (nginx, Cloudflare, ALB) in front of both the API and web servers.
- Configure **Redis authentication** (`requirepass`) and **PostgreSQL SSL** (`?sslmode=require` in `DATABASE_URL`) for production deployments.

---

## Testing

```bash
npm run test:api
```

Vitest runs both **unit tests** (`*.test.ts`) and **integration tests** (`*.integration.test.ts`) in the API workspace. Integration tests (for example `auth.integration.test.ts`) exercise login, refresh (cookie-based), profile, password change, logout-all, and related flows via Supertest against the HTTP app created in `httpApp.ts`. The `roleNameContract.test.ts` validates that role name constants stay in sync across the codebase.

### CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs **three parallel jobs** on every push/PR to `main`:

| Job | What it does |
|-----|-------------|
| **Lint** | `next lint` on the web package |
| **Typecheck & Build** | `tsc` (API) + `next build` (Web) |
| **Test** | Spins up Postgres + Redis service containers, runs migrations, executes all API tests |

---

## Troubleshooting

### Web loads but `/_next/static/...` returns 404

Stale Next dev cache vs browser cache mismatch.

1. Stop **all** Node/Next processes using the web port (default **3000**).
2. From repo root: **`npm run dev:clean`** or delete **`apps/web/.next`**, then **`npm run dev`**.
3. Hard refresh (**Ctrl+Shift+R**) or clear **Application → Site data** for localhost.

### `EADDRINUSE` on port 3000 or 3001

Another process owns the port. On Windows: `netstat -ano | findstr ":3000"` (or `3001`), then end the PID in Task Manager, or set **`WEB_PORT`** for the web dev script.

### Long tab spinner on first visit (dev)

First compile of `/` and route chunks often takes **10–30 seconds** on a cold start. If it **never** completes, run **`npm run dev:clean`** and ensure only **one** Next dev server uses the port.

### API unreachable from browser

Confirm **`npm run dev`** (or `dev:api`) is running, **`NEXT_PUBLIC_API_URL`** matches the API host/port, and nothing blocks localhost.

### `__webpack_modules__... is not a function`

Usually a dev/prod chunk mix or HMR glitch: **`npm run clean:web`**, restart dev, try disabling aggressive browser extensions on localhost.

### Ask returns 503 "AI service is not configured"

Set **`GEMINI_API_KEY`** in `apps/api/.env` and restart the API.

### JWT_SECRET error at startup

The API requires `JWT_SECRET` to be at least **32 characters**. Generate one with: `openssl rand -hex 32`. In production (`NODE_ENV=production`), the server will exit if this check fails.

---

## License

Private project.
