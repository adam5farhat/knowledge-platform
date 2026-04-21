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
8. [Middleware pipeline](#middleware-pipeline)
9. [Error handling](#error-handling)
10. [Graceful shutdown](#graceful-shutdown)
11. [AI / RAG pipeline](#ai--rag-pipeline)
12. [Document ingest worker](#document-ingest-worker)
13. [Data model (overview)](#data-model-overview)
14. [Migration history](#migration-history)
15. [Backend module reference (`apps/api/src/lib`)](#backend-module-reference-appsapisrclib)
16. [API reference (routes)](#api-reference-routes)
17. [Web application (routes)](#web-application-routes)
18. [Frontend internals](#frontend-internals)
19. [Prerequisites](#prerequisites)
20. [Quick start](#quick-start)
21. [Environment variables](#environment-variables)
22. [Scripts (repository root)](#scripts-repository-root)
23. [Code style and formatting](#code-style-and-formatting)
24. [Production deployment notes](#production-deployment-notes)
25. [Testing](#testing)
26. [Troubleshooting](#troubleshooting)
27. [RAG evaluation and tuning](#rag-evaluation-and-tuning)
28. [Operational CLIs (reindex, feedback export)](#operational-clis-reindex-feedback-export)
29. [Documentation hub (diagrams & UML)](#documentation-hub-diagrams--uml)
30. [License](#license)

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

- **Hybrid retrieval**: `/search/ask` combines **pgvector similarity** with **PostgreSQL full-text (BM25-style)** search, then **weighted reciprocal rank fusion (RRF)** to merge rankings before LLM reranking (dense/sparse weights and `k` are env-tunable).
- **Query understanding**: `queryOptimizer.ts` classifies **query type** (factual, summary, compare, procedural, out-of-scope), rewrites the question for retrieval, derives a **topic** string (stored on `Conversation` for feedback scoping), and can emit **multi-hop** sub-queries when needed.
- **Optional HyDE**: Hypothetical-document embeddings for the vector leg (`RAG_USE_HYDE` or per-request `useHyde: true`).
- **Neighbor expansion**: After rerank, adjacent chunks in the same document version can be pulled in for wider context (`RAG_NEIGHBOR_EXPANSION`, default on).
- **Metadata filters**: Ask requests can narrow retrieval by MIME types, tags, document IDs, and document creation date range.
- **Reranking & confidence**: Chunks are **reranked with Gemini**; answers use a **confidence** level derived from chunk scores (`ragCompletion.ts`).
- **Streaming answers**: `/search/ask` responds as **SSE** with typed events: `sources`, `token`, optional `correction`, then `done`.
- **Post-answer quality pass**: **Iterative critique** (configurable rounds) can stream **`correction-token`** then **`correction`**, surface issues via **`warning`**, and run **per-claim cosine verification** against retrieved chunks (`claimVerifier.ts` → **`verification`** SSE).
- **Answer cache**: Deterministic cache of final answers (`answerCache.ts`, TTL via `RAG_ANSWER_CACHE_TTL`); bump **`RAG_PROMPT_VERSION`** or change prompts to invalidate.
- **Follow-up chips**: After `done`, the API can emit **`followups`** with suggested next questions (`followUps.ts`).
- **Conversations**: Persisted threads and messages with **sources**, **confidence**, and **`topic`** on the thread (from the optimizer); title generation endpoint.
- **Answer feedback**: `AnswerFeedback` model (one rating per message per user flow) plus **stats** endpoint for analytics-style views.
- **Multi-department access**: `UserDepartmentAccess` junction table with **migration backfill** from legacy "single primary department" users; auth middleware attaches **`readableDepartmentIds`** and **`manageableDepartmentIds`** for consistent enforcement.
- **Embeddings**: **768-dimensional** vectors (see migration `switch_embedding_768`); HNSW-style vector index migration for performance.
- **Chunking options**: Sentence-aware splitting (`Intl.Segmenter`), table-aware handling so XLSX/HTML tables stay intact as markdown, optional **embedding-based semantic boundaries** on oversize chunks (`RAG_SEMANTIC_CHUNK`, ingest-time cost).
- **Async ingest**: **BullMQ** worker embedded in the API process: MIME-specific extract → chunk → embed → persist chunks. Failed jobs are retained with a 7-day TTL and 500-count cap for debugging.
- **Reindex without re-upload**: CLI enqueues the same ingest pipeline for existing versions (`reindex.ts`).
- **RAG evaluation**: Code-defined case suite, automated judge metrics, JSON reports under `apps/api/eval-reports/` (`ragEvaluation.ts`, `ragJudge.ts`, `ragHarness.ts`).
- **A/B flags**: Hash-stable per-user variants from env `FLAG_<NAME>=variant:weight,...` (`featureFlags.ts`), used e.g. for prompt version experiments alongside `RAG_PROMPT_VERSION`.
- **Notification system**: Automatic notifications on document lifecycle events (create, update, delete), role changes (manager assigned/removed), and member additions — all department-scoped. Admins and managers can also send **manual announcements** with optional **file attachments** (downloadable by recipients). The frontend features a **bell icon with live unread badge** (10-second polling + visibility-change detection), a **slide-in panel** with infinite scroll, detail modals, and an in-panel **send notification form** with attachment support.
- **Hardening**: Comprehensive security audit and fixes applied (see [Security](#security-access-control-and-departments) below), including rate limiting on all sensitive endpoints, **TTL cache** and **retry with backoff** for Gemini rate limits (`cache.ts`), coordinated **refresh token** handling in the web client to avoid double-refresh races, **refresh token family revocation** (replay detection invalidates the entire session chain), CSP headers (including `frame-src 'self' blob:` for document previews), CSV injection protection, and timing-attack mitigations.
- **Frontend animation polish**: Reusable CSS `@keyframes` library (`kp-fadeUp`, `kp-fadeIn`, `kp-cardIn`, `kp-modalBackdropIn`, `kp-modalContentIn`, `kp-slideInRight`) with shared timing variables and a global `prefers-reduced-motion` override. Entrance animations on pages, staggered card reveals on dashboards, smooth hover/focus transitions on buttons, inputs, and menus across every major view.
- **Inline document preview**: PDF and image files open in a modal overlay directly from the documents list — PDFs via `<iframe src={blobUrl}>`, images as `<img>`. A **backdrop-close shield** prevents the opening click from accidentally closing the modal (flicker protection). Keyboard dismiss (Escape) and proper blob URL cleanup are built in.
- **Client-side navigation**: All authenticated navigation links use Next.js `<Link>` for client-side routing, preserving the in-memory access token across page transitions (prevents accidental logouts caused by full-page reloads).
- **Adaptive dashboard layout**: The dashboard card grid automatically switches between a 2-column and 3-column layout depending on how many cards are visible for the user's role, eliminating empty grid cells.

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
  Docs --> Redis
  Express --> Redis
  Search --> PG
  Search --> Emb
  Search --> Chat
  Conv --> PG
  Conv --> Chat
  Bull --> Redis
  Bull --> PG
  Bull --> Disk
  Bull --> Emb
```

- **Web** calls the **API** using `NEXT_PUBLIC_API_URL` (browser `fetch`). Access tokens are held **in-memory** (never persisted to localStorage); refresh tokens are stored in **HttpOnly, Secure, SameSite=Lax cookies** (`kp_rt`, path `/auth`). Refresh uses a **single in-flight** promise so parallel requests do not invalidate rotated refresh tokens.
- **Document ingest** is processed by a **BullMQ consumer** started from `apps/api/src/index.ts` after the HTTP server listens.

---

## Technology stack

| Layer | Technology |
|--------|------------|
| **Web** | Next.js 15, React 19, TypeScript, App Router, CSS modules, `react-markdown` + `remark-gfm` (Ask UI markdown), `next-themes` (light/dark/system), `@next/bundle-analyzer` |
| **API** | Node.js 22, Express 4, TypeScript (ESM via `NodeNext`), Zod validation, `AppError` structured errors, `compression` (gzip/deflate) |
| **Database** | PostgreSQL 16 + **pgvector** (Prisma ORM, 29 migrations) |
| **Cache / queue** | Redis 7, BullMQ |
| **Auth** | JWT access tokens (HS256, 15-minute default TTL) in-memory; refresh tokens in **HttpOnly cookies**; `authVersion` invalidation on password/role/email changes; **session cap** (10 per user) |
| **Security** | Helmet (CSP), frontend CSP via Next.js headers (including `frame-src` for blob previews), CORS origin validation, rate limiting (login, refresh, forgot/reset password, change password, ask), bcrypt-12, password complexity rules (10–72 chars, mixed case, digit, special), refresh token family revocation, timing-attack mitigations, CSV injection protection |
| **AI** | **Google Gemini** (`@google/generative-ai`): embeddings (768-dim), query optimization, chunk reranking, streaming answers |
| **Text extraction** | `pdf-parse` (PDF), `mammoth` (DOCX), `word-extractor` (legacy DOC), `xlsx` (spreadsheets), **pptx** via `jszip`, `cheerio` (+ `html-to-text` where useful) for HTML, JSON, `fast-xml-parser` (XML), `jszip` (ZIP archives), plus Gemini OCR fallback for scanned PDFs (≤ 20 MB) |
| **Files** | Multer uploads, configurable `STORAGE_PATH`, streaming downloads, MIME allowlist validation |
| **Email** | Nodemailer with TLS enforcement (optional SMTP; dev logs reset links if SMTP unset) |
| **DevOps** | Multi-stage **Dockerfiles** (API + Web, Node 22 Alpine), **docker-compose** (dev) + **docker-compose.prod.yml** (production), **GitHub Actions CI** (lint, audit, typecheck, test), structured **JSON logger** in production |
| **Code quality** | Prettier (double quotes, trailing commas, 100 print width, LF), ESLint flat config (TypeScript-aware, per workspace), Vitest (integration + unit) |
| **UX** | Toast notifications, confirm dialogs, shared spinner, accessible search with responsive CSS, **real-time notification system** with polling, downloadable attachments, **CSS animation system** (`@keyframes` library with `prefers-reduced-motion` support), inline document previews (PDF + image), **light/dark/system theming** via `next-themes` and CSS variables (details under **Web UX → Theming** below) |

> **Note:** The API `package.json` lists an `openai` dependency for tooling compatibility, but **runtime RAG and embeddings use Gemini**. Configure **`GEMINI_API_KEY`** for ingest and ask flows.

---

## Repository layout

```
finalproject/
├── apps/
│   ├── api/                        # Express API, Prisma schema & migrations, ingest worker
│   │   ├── Dockerfile              # Multi-stage production image (Node 22 Alpine)
│   │   ├── docker-entrypoint.sh    # Runs prisma migrate deploy then starts API
│   │   ├── eslint.config.mjs       # Flat ESLint config (typescript-eslint)
│   │   ├── vitest.config.ts        # Test runner config
│   │   ├── prisma/
│   │   │   ├── schema.prisma       # Data model (20+ models, 8 enums)
│   │   │   ├── migrations/         # 29 sequential migrations
│   │   │   └── seed.ts             # Roles, departments, sample users
│   │   └── src/
│   │       ├── index.ts            # Server startup, worker init, shutdown handler
│   │       ├── httpApp.ts          # Express app factory (middleware chain, routes, error handler)
│   │       ├── routes/             # auth, admin, manager, documents, search, conversations, notifications, avatarsPublic
│   │       ├── middleware/          # auth (JWT + role + dashboard), restrictions (feature gates)
│   │       ├── lib/                # config, AppError, logger, schemas, access control, RAG, storage, email…
│   │       ├── jobs/               # documentIngest (BullMQ consumer)
│   │       └── *.integration.test.ts  # Vitest integration tests (per domain)
│   └── web/                        # Next.js 15 frontend
│       ├── Dockerfile              # Multi-stage production image (Node 22 Alpine)
│       ├── next.config.ts          # CSP headers, rewrites, bundle analyzer
│       ├── middleware.ts           # Dev-only no-cache headers for HTML
│       ├── app/                    # App Router pages (22 routes), layouts, error/loading boundaries
│       ├── components/             # Toast, ConfirmDialog, Spinner, Notifications, Providers, avatars, file icons…
│       └── lib/                    # apiBase, authClient, restrictions, fileToAvatarBlob, profilePicture
├── docs/                           # Documentation hub
│   ├── README.md                   # Docs index
│   ├── architecture.md             # Platform architecture narrative + Mermaid diagram
│   ├── platform-functionality-inventory.md
│   └── diagrams/                   # PlantUML sources grouped by type
│       ├── architecture/           # platform-architecture.puml
│       ├── sequence/               # seq-01 … seq-41 (.puml) + README index
│       ├── use-case/               # global-use-case-diagram.puml + narrative
│       └── class/                  # global-class-diagram.puml + narrative
├── scripts/
│   ├── dev-api.mjs                 # Spawn tsx watch for API
│   ├── dev-web.mjs                 # Spawn Next.js dev server
│   ├── clean-web-next.mjs          # Delete apps/web/.next
│   └── backup-db.sh               # pg_dump + gzip, retains last 30 backups
├── .github/workflows/ci.yml       # CI: lint, audit, typecheck+build, test (4 parallel jobs)
├── .prettierrc                     # Prettier config (double quotes, trailing commas, 100 width, LF)
├── .prettierignore                 # Excludes node_modules, dist, .next, migrations, lockfile
├── .dockerignore                   # Keeps Docker build context lean
├── .gitignore                      # Standard ignores + storage/uploads, coverage, backups
├── docker-compose.yml              # Dev: Postgres + Redis + API + Web (local creds)
├── docker-compose.prod.yml         # Prod: Redis auth, upload volume, full env surface, port overrides
└── package.json                    # npm workspaces (apps/*) + root scripts
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
- **Refresh suppression**: The web client detects when no valid refresh token exists (e.g. after logout or 401) and suppresses further `/auth/refresh` calls until the next successful login — eliminates console noise and wasted network requests.
- **Change-password rate limiting**: Dedicated rate limiter on `/auth/change-password` to prevent brute-force password guessing by authenticated users.

### Document library

- Upload documents and **new versions**; processing lifecycle (`PENDING` → `PROCESSING` → `READY` / `FAILED`) with progress where supported.
- **Visibility**: `ALL`, `DEPARTMENT`, `PRIVATE` enforced server-side via `documentAccess.ts`, `documentQuery.ts`, and JWT-enriched **readable department IDs**.
- **Tags**, **favorites**, **recents**, **archive**, **delete** (permission-checked).
- **Audit log** of document events (admin UI + CSV export with formula-injection protection).
- **Inline preview**: PDF and image files can be opened in a modal overlay directly from the document list. PDFs render via `<iframe src={blobUrl}>`, images via `<img>`. A **backdrop-close shield** prevents flicker (the opening click finishing on the new backdrop). Escape key dismisses the preview; blob URLs are revoked on close.

### Search and AI

- **POST `/search/semantic`**: Vector search over embedded chunks (with access filters). Optional `{ "optimize": true }` runs the same query rewrite used before embedding (see `semanticBody` in `search.ts`).
- **POST `/search/ask`**: Full pipeline — optimize (type, topic, rewrite, sub-queries) → parallel vector + BM25 with **symmetric** query text → weighted RRF → optional HyDE / multi-hop → **must-exclude soft penalty** → rerank → neighbor expansion → generation → optional iterative critique, claim verification, follow-ups — all over **SSE** (see [API reference](#api-reference-routes)).
- **Rate limiting** on the ask endpoint (applied after authentication to prevent unauthenticated IP exhaustion).
- **TTL cache** and **retry with backoff** for provider rate limits.

### Conversations

- List/create/update/delete conversations; append messages; **generate title**.
- **Feedback** on assistant messages (rating + optional comment); **feedback stats** endpoint.
- **Feedback memory** pulls recent negative patterns into the ask prompt when relevant, **scoped by conversation topic** and optionally ranked with **embedding similarity** to the current question (`feedbackMemory.ts`).

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

- **Bell icon** (`NotificationBell`): Appears in the navigation bar of every page. Displays an **unread count badge** that updates via polling (every 10 seconds) and on tab focus (`visibilitychange` event). Notification API calls are **automatically skipped on public auth pages** (login, register, forgot-password, reset-password) to avoid unnecessary `/auth/refresh` traffic when the user isn't signed in.
- **Slide-in panel** (`NotificationPanel`): Lists all notifications with infinite scroll pagination, mark-as-read on click, "Mark all read" bulk action, and per-item delete.
- **Detail modal**: Opens on click with full notification body, sender info, timestamp, human-readable type label (e.g. "Announcement" instead of "MANUAL"), and a **download button** for attachments (uses authenticated `fetchWithAuth` + blob download).
- **Send modal** (`SendNotificationModal`): In-panel form for admins/managers to compose and send notifications with file attachments. Escape key handling and outside-click isolation prevent accidental panel closure.

### Web UX

- Role-aware **home routing** (`homePathForUser` in `lib/restrictions.ts`).
- **Dashboard** with an **adaptive card grid** — automatically switches between 2-column (even card count) and 3-column (odd card count) layout based on the user's visible cards (Documents, Ask, Department overview, Administration), eliminating empty grid cells.
- **Documents** browser, **search** (with responsive CSS and full accessibility), **Ask** (RAG UI with markdown rendering, link sanitization via `rel="noopener noreferrer nofollow"`), **profile**, **restricted** explanation page. Inline **PDF/image preview** modals with flicker protection.
- **Admin** hub (users, departments, documents, activity, audit, system) and **manager** dashboard with shared chrome.
- **Client-side navigation**: All authenticated links (logo, nav items) use Next.js `<Link>` for client-side routing, preserving the in-memory access token across page transitions and preventing accidental logouts from full-page reloads.
- **Toast notifications**: context-based system replacing all native `alert()` calls — supports info, success, error, and warning types with slide-in/out animations and auto-dismiss.
- **Confirm dialogs**: promise-based component replacing all native `confirm()` calls — with keyboard support (Escape), focus management, danger mode styling, and `aria-modal` accessibility.
- **Shared Spinner**: SVG-animated loading indicator with `role="status"` and configurable size.
- **Error boundaries** (`error.tsx`, `global-error.tsx`) with Home link pointing to `/dashboard`.

#### Animation system

A reusable **CSS animation library** in `globals.css` provides consistent motion across the platform:

| Keyframe | Effect |
|----------|--------|
| `kp-fadeUp` | Fade in + translate upward (page/section entrances) |
| `kp-fadeIn` | Simple opacity fade |
| `kp-cardIn` | Scale up + fade (dashboard/hub cards with staggered `animation-delay`) |
| `kp-modalBackdropIn` | Backdrop fade for modals and overlays |
| `kp-modalContentIn` | Scale + fade for modal dialogs |
| `kp-slideInRight` | Slide-in from the right (detail panels) |

Shared CSS custom properties (`--ease-out`, `--ease-spring`, `--dur-fast`, `--dur-normal`, `--dur-modal`) ensure consistent timing. All animations respect **`prefers-reduced-motion: reduce`** — motion is suppressed to instant transitions for users who prefer reduced motion.

#### Theming (light / dark mode)

- **Runtime**: [`next-themes`](https://github.com/pacocoursey/next-themes) wraps the app in [`apps/web/components/Providers.tsx`](apps/web/components/Providers.tsx) (`ThemeProvider` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `storageKey="kp-theme"`). The active theme is stored in **localStorage** under `kp-theme` and synced to a **`dark` class on `<html>`** (no flash of wrong theme when configured as in the Next.js App Router pattern).
- **Tokens**: Semantic colors live in [`apps/web/app/globals.css`](apps/web/app/globals.css) under `:root` (light) and `html.dark` (dark): surfaces (`--surface`, `--surface-subtle`, …), text (`--text`, `--muted`), borders, interactive colors, overlays, toasts, chart/search accents, banners, and slab/tint variables used across CSS modules.
- **UI**: **Theme** control appears in profile dropdowns (`ThemeToggleMenu` — Light / Dark / System) on dashboard, documents, ask, profile, and admin/manager chrome; auth pages use compact icon toggles (`ThemeToggleCorner`). New screens should prefer **`var(--token)`** over raw hex so both themes stay correct.

---

## Security, access control, and departments

### Authentication hardening

| Control | Implementation |
|---------|----------------|
| **JWT signing** | HS256 algorithm pinned explicitly; secret minimum **32 characters** enforced at startup |
| **Access token TTL** | Default **15 minutes** (configurable via `JWT_EXPIRES_IN`); short-lived to limit stolen-token exposure |
| **Access token storage** | Held **in-memory only** (never persisted to localStorage or cookies) |
| **Refresh tokens** | **HttpOnly, Secure, SameSite=Lax cookies** (`kp_rt`, path `/auth`); 30-day TTL, atomic rotation (old token revoked in same transaction), **family revocation** on replay detection (reuse of a rotated token invalidates the entire session chain) |
| **Session cap** | Maximum **10** concurrent sessions per user; oldest session auto-revoked on overflow |
| **Password policy** | 10–72 characters; must include uppercase, lowercase, digit, and special character (shared `passwordPolicy.ts`); 72-char max prevents bcrypt silent truncation |
| **`authVersion`** | Incremented on password change, email change, role change, restriction change — instantly invalidates all existing tokens |
| **Password hashing** | bcrypt with 12 rounds, automatic salt |
| **Timing attacks** | Dummy bcrypt on invalid-email login; minimum 500ms + random jitter on forgot-password regardless of email existence |
| **Same-password block** | `/change-password` rejects `newPassword === currentPassword` |
| **Refresh suppression** | Web client detects logged-out state (401/403 from refresh) and suppresses further `/auth/refresh` calls until the next successful login — eliminates console noise and wasted requests |

### Rate limiting

| Endpoint | Limit |
|----------|-------|
| `/auth/login` | 15 / 15 min / IP |
| `/auth/refresh` | 30 / 15 min / IP |
| `/auth/forgot-password` | 8 / hour / IP |
| `/auth/reset-password` | 10 / 15 min / IP |
| `/auth/change-password` | 10 / 15 min / IP (applied after authentication) |
| `/search/ask` | 12 / min / IP (applied after authentication) |

### Transport and headers

- **API Helmet** with restrictive **Content-Security-Policy** (`default-src 'none'`, `frame-ancestors 'none'`, `connect-src 'self'`).
- **Frontend CSP** via `next.config.ts` headers: `script-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https: <api>`, `frame-src 'self' blob:` (for PDF/image blob previews), `connect-src 'self' <api>`, `frame-ancestors 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy`.
- **CORS**: allowed origins come from `WEB_APP_URL` (one origin or comma-separated list). With `NODE_ENV=production`, **`WEB_APP_URL` is required** — the API process exits at startup if it is missing. In development/test it defaults to `http://localhost:3000` when unset.
- **SMTP TLS**: `requireTLS: true` enforced on the nodemailer transporter when not using implicit TLS.

### Access control

1. **JWT** carries user id, email, role, primary `departmentId`, and `authVersion`. `authenticateToken` loads the live user from the database on each request (no snapshot cache), rejects stale tokens with `ACCESS_TOKEN_OUTDATED` if email/role/department have changed, and computes:
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

## Middleware pipeline

The Express app (`apps/api/src/httpApp.ts`) applies middleware in a strict order. Every request passes through these layers before reaching route handlers:

| Order | Middleware | Purpose |
|-------|-----------|---------|
| 1 | `trust proxy` | Honors `X-Forwarded-*` headers when behind a reverse proxy. Controlled by `TRUST_PROXY` env var (hop count or subnet). |
| 2 | `helmet()` | Sets security HTTP headers: restrictive CSP (`default-src 'none'`, `script-src 'none'`, `connect-src 'self'`, `frame-ancestors 'none'`), plus HSTS, X-Content-Type-Options, etc. |
| 3 | `compression()` | gzip / deflate response compression for all responses. |
| 4 | `cookieParser()` | Parses incoming cookies so the refresh token cookie (`kp_rt`) is available as `req.cookies`. |
| 5 | `cors()` | Validates `Origin` against `WEB_APP_URL` (comma-separated origins supported). Credentials mode enabled for cookie-based refresh. |
| 6 | `express.json({ limit: "1mb" })` | Parses JSON request bodies up to 1 MB. |
| 7 | Request ID | Reads `x-request-id` from the incoming request header or generates one via `crypto.randomUUID()`. Stores it in `res.locals.requestId` and sets the `x-request-id` response header for distributed tracing. |

After middleware, routers are mounted in this order: `/avatars` (public, no auth), `/auth`, `/admin`, `/manager`, `/documents`, `/search`, `/conversations`, `/notifications`. Then the root `GET /` probe and `GET /health` check. Finally, the 404 catch-all and global error handler.

---

## Error handling

The API uses a two-layer error strategy defined at the bottom of `httpApp.ts`:

**1. 404 catch-all** — Any request that does not match a router or the root routes receives `404 { error: "Not found" }`.

**2. Global error middleware** — Catches all errors thrown or forwarded by `express-async-errors`:

| Error type | Behavior |
|------------|----------|
| `AppError` (structured) | Responds with the error's `status` code, `{ error: message }`, and optional `code` and `details` fields for client-side handling. |
| Unknown / untyped errors | Logged with the `requestId` at `error` level. Responds with `500 { error: "Internal server error" }`. In non-production environments, a `debug` field exposes the original message for development convenience. |

Every error response includes the `x-request-id` header so logs can be correlated with client requests.

`AppError` provides static factories for common cases: `AppError.badRequest()`, `.unauthorized()`, `.forbidden()`, `.notFound()`, `.conflict()` — each with an optional `code` string and `details` object. Zod validation failures are surfaced as `badRequest` with `details` from `parsed.error.flatten()`.

---

## Graceful shutdown

When the API process receives `SIGTERM` or `SIGINT` (container stop, Ctrl+C, or orchestrator signal), it executes a coordinated shutdown sequence defined in `apps/api/src/index.ts`:

| Step | Action | Why |
|------|--------|-----|
| 1 | `stopDocumentIngestWorker()` | Lets the BullMQ worker finish its current job and close cleanly; prevents half-processed documents. |
| 2 | `server.close()` | Stops accepting new HTTP connections; in-flight requests finish. |
| 3 | `prisma.$disconnect()` | Closes the database connection pool. |
| 4 | `closeRedis()` | Disconnects the application Redis client. |
| 5 | `process.exit(0)` | Clean exit. |

If any step throws, the error is logged and the process still exits.

---

## AI / RAG pipeline

### 1. Ingest (worker)

File from disk → **extract** plain text (MIME-specific strategies in `extractText.ts`) → **chunk** (`chunkText.ts`, optional `semanticChunk.ts`) → **embed** with Gemini (768 dims) → store in `DocumentChunk` with vector + full-text (`tsvector`).

### Text extraction formats (`extractText.ts`)

| Format | Library | Notes |
|--------|---------|-------|
| **PDF** | `pdf-parse` | Falls back to **Gemini OCR** for scanned/image-only PDFs (≤ 20 MB). |
| **Word (.docx)** | `mammoth` | Converts to HTML, then to plain text. |
| **Word (.doc)** | `word-extractor` | Legacy binary Word format. |
| **PowerPoint (.pptx)** | `jszip` + XML | Slide XML text; legacy `.ppt` rejected with a clear error. |
| **Spreadsheets (.xlsx, .xls, .csv)** | `xlsx` | Tables can be emitted as markdown for chunking. |
| **HTML** | `cheerio` (+ `html-to-text` where useful) | DOM-aware extraction. |
| **JSON** | Built-in / normalization | Structured text for RAG. |
| **XML** | `fast-xml-parser` | Extracts text nodes from arbitrary XML. |
| **ZIP archives** | `jszip` | Recursively extracts and processes contained files. |
| **Plain text (.txt, .md, .log, …)** | Built-in | Direct UTF-8 read. |

MIME types accepted for upload are controlled by `SUPPORTED_EXTRACTION_MIMES` in `extractText.ts`. `resolveMimeType` normalizes the MIME before dispatch.

### Chunking (`chunkText.ts` + neighbors)

- Character targets: `CHUNK_SIZE_CHARS`, `CHUNK_OVERLAP_CHARS`, `CHUNK_MAX_CHARS` (see [Environment variables](#environment-variables)).
- **Sentence boundaries** use `Intl.Segmenter` when available.
- **Tables** from spreadsheets / HTML are kept as single markdown blocks where possible so rows are not split across chunks.
- **Semantic re-split** (optional): when `RAG_SEMANTIC_CHUNK=true`, oversize segments can be split on embedding-similarity valleys (`semanticChunk.ts`).

### 2. Ask (`POST /search/ask`)

High-level order (see `apps/api/src/routes/search.ts` and `ragCompletion.ts`):

1. **Optimize** — `queryOptimizer.ts`: `rewrittenQuery`, `keywords`, `topic`, `queryType`, optional `subQueries`, must-include / must-exclude lists.
2. **Retrieve** — Same optimized text drives **both** vector embedding and BM25 `plainto_tsquery` (symmetric hybrid). Results merged with **weighted RRF** (`RRF_DENSE_WEIGHT`, `RRF_SPARSE_WEIGHT`, `RRF_K`). Optional **HyDE** (`hyde.ts`, env or body). Optional **extra vector passes** for sub-queries.
3. **Filter / soften** — Chunks matching must-exclude terms get a **score penalty** rather than hard removal (`RAG_MUST_EXCLUDE_PENALTY`).
4. **Rerank** — Gemini cross-passage scoring in `reranker.ts` with `RAG_RERANK_PASSAGE_CHARS` and `RAG_RERANK_DEPTH`.
5. **Expand** — `neighborExpansion.ts` pulls adjacent `chunkIndex` neighbors when enabled.
6. **Generate** — Streaming answer with citations; system prompts live in `prompts.ts` (version picked via feature flag / `RAG_PROMPT_VERSION`).
7. **Quality** — `ragEvaluation.ts`: iterative critique, streaming correction, `claimVerifier.ts` cosine checks → SSE `verification` / `warning`.
8. **Cache** — Final text keyed by question + sources + prompt variant (`answerCache.ts`).
9. **Follow-ups** — `followUps.ts` suggests three next questions.

**SSE** shape is documented under [API reference](#api-reference-routes) (`sources` includes `topic`, `rewrittenQuery`, `queryType`, `promptVariant`).

### 3. Feedback memory

Before generation, recent **negative** feedback "lessons" are merged into the system context when they match the current **topic** and (when embeddings are available) are semantically close to the question (`feedbackMemory.ts`). **Positive** ratings can be exported to eval candidate JSON (see [Operational CLIs](#operational-clis-reindex-feedback-export)).

### 4. Utilities and evaluation

- `cache.ts` — TTL cache, `withRetry` for Gemini rate limits.
- `ragEvaluation.ts` — Critique loop, CLI entrypoints for the eval harness (`npm run eval:rag`).
- `ragJudge.ts` / `ragHarness.ts` — Automated scoring and report generation.

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
| **AI chat** | `Conversation` (includes optional `topic` from RAG optimizer), `ConversationMessage`, `AnswerFeedback` |
| **Notifications** | `Notification` (type, title, body, actor, target, attachment fields), `UserNotification` (per-recipient read state) |
| **Auth** | `RefreshSession`, `AuthEvent`, `PasswordResetToken` |

Migrations are detailed in the next section.

---

## Migration history

All 29 Prisma migrations under `apps/api/prisma/migrations/`, listed chronologically. Each folder contains a `migration.sql` applied by `prisma migrate deploy`.

| # | Migration | Purpose |
|---|-----------|---------|
| 1 | `20250325120000_enable_pgvector` | Enable the `pgvector` PostgreSQL extension for vector storage. |
| 2 | `20250325120001_app_meta` | Initial application metadata table(s). |
| 3 | `20250325140000_sprint1_auth_rbac` | Core auth and RBAC: `User`, `Role` (`ADMIN` / `MANAGER` / `EMPLOYEE`), `Department` (self-referential hierarchy). |
| 4 | `20250326120000_sprint2_documents` | `Document`, `DocumentVersion`, `DocumentChunk` with vector column. |
| 5 | `20250327120000_remove_organization` | Drop legacy organization table; simplify to departments only. |
| 6 | `20250328120000_auth_password_reset` | `PasswordResetToken` model (hashed token, expiry). |
| 7 | `20250328200000_document_tags` | `DocumentTag` model and implicit many-to-many with `Document`. |
| 8 | `20250329120000_user_auth_version` | Add `authVersion` column to `User` for token invalidation. |
| 9 | `20250330120000_refresh_sessions` | `RefreshSession` model (hashed token, family ID for replay detection, device metadata). |
| 10 | `20250330123000_auth_lockout_audit` | `AuthEvent` model (append-only auth audit log), `failedLoginAttempts`, `loginLockedUntil` on `User`. |
| 11 | `20260328013737_document_library_extensions` | `DocumentUserFavorite`, `DocumentUserRecent`, `DocumentAuditLog`, `DocumentVisibility` enum, archive flag. |
| 12 | `20260328020000_audit_log_document_nullable` | Make `documentId` nullable on audit log so entries survive document deletion. |
| 13 | `20260328130000_document_global_archive` | Global archive fields on `Document`. |
| 14 | `20260328150000_user_action_restrictions` | Feature restriction booleans on `User` (`loginAllowed`, `accessDocumentsAllowed`, `useAiQueriesAllowed`, etc.). |
| 15 | `20260328160000_user_management_extensions` | Additional admin fields: badge, position, soft-delete `deletedAt`, profile picture URL. |
| 16 | `20260329103000_user_profile_bio` | Add `bio` column to `User`. |
| 17 | `20260329120000_drop_user_bio` | Remove `bio` column (design change). |
| 18 | `20260404000000_restore_hnsw_vector_index` | Create/restore HNSW index on `DocumentChunk.embedding` for fast ANN search. |
| 19 | `20260404100000_add_processing_progress` | `processingProgress` field on `DocumentVersion` for ingest status tracking. |
| 20 | `20260404110000_switch_embedding_768` | Change embedding dimension from 1536 to **768** (Gemini `gemini-embedding-001`). |
| 21 | `20260404120000_rag_hybrid_search` | Add `searchVector` (`tsvector`) column to `DocumentChunk` for BM25-style full-text search. |
| 22 | `20260404130000_conversations` | `Conversation` and `ConversationMessage` models for AI chat history. |
| 23 | `20260404140000_answer_feedback` | `AnswerFeedback` model (rating + comment per message). |
| 24 | `20260404180734_user_department_access` | `UserDepartmentAccess` junction table with `DepartmentAccessLevel` enum. Includes **data backfill** migration from legacy single-department users. |
| 25 | `20260406210007_notifications` | `Notification` and `UserNotification` models, `NotificationType` and `NotificationTarget` enums. |
| 26 | `20260406221501_notification_document_fk` | Add optional `documentId` FK on `Notification` for document-event notifications. |
| 27 | `20260407000000_restore_search_indexes` | Re-create/tune search-related indexes (vector + full-text). |
| 28 | `20260407100000_notification_actor_index` | Index on `Notification.actorId` for actor-based lookups. |
| 29 | `20260421120000_conversation_topic` | Adds nullable `Conversation.topic` — populated from the query optimizer on `/search/ask` so feedback memory can scope lessons by topic. |

Run all pending migrations:

```bash
npm run db:migrate          # prisma migrate deploy
```

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
| `extractText.ts` / `chunkText.ts` | MIME-specific extraction; sentence- and table-aware chunking (20 MB OCR limit) |
| `embeddings.ts` | Gemini embeddings (768-dim, empty-result guard) |
| `queryOptimizer.ts` / `reranker.ts` / `ragCompletion.ts` | RAG orchestration (retrieval, generation, streaming, timeouts) |
| `ragEvaluation.ts` | Critique / correct loops, eval CLI, judge integration |
| `ragJudge.ts` / `ragHarness.ts` | Automated metrics and full-pipeline eval reports |
| `prompts.ts` | Versioned system prompts for answer / critique / follow-ups |
| `hyde.ts` | HyDE hypothetical document embedding for vector leg |
| `neighborExpansion.ts` | Adjacent-chunk context expansion after rerank |
| `semanticChunk.ts` | Optional embedding-based chunk boundaries (ingest) |
| `claimVerifier.ts` | Per-claim embedding verification vs sources |
| `followUps.ts` | LLM-generated follow-up question chips |
| `answerCache.ts` | TTL cache for final streamed answers |
| `featureFlags.ts` | Env-driven `FLAG_*` hash-stable A/B variants |
| `feedbackMemory.ts` | Negative (and similarity-ranked) feedback lessons; topic-scoped |
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

Authenticated JSON APIs use `Authorization: Bearer <access_token>` unless noted. All request bodies are validated with **Zod**; invalid bodies return `400` with structured `details`.

### Root endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | No | Service probe — returns `{ ok: true, service: "knowledge-platform-api" }` |
| `GET` | `/health` | No | Database + Redis liveness checks. Returns `200 { status: "ok" }` if both healthy, `503 { status: "degraded" }` with per-check detail if either fails. Includes `timestamp`. |

### Avatars (public)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/avatars/:userId/:filename` | No | Serve avatar image from storage. Validates the path matches the user's stored `profilePictureUrl`. |

### Auth (`/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/login` | No | Login with `{ email, password }`. Sets HttpOnly refresh cookie `kp_rt`. Returns `{ user, token }`. Rate limited (15 / 15 min / IP). |
| `POST` | `/auth/refresh` | Cookie | Rotate refresh token from `kp_rt` cookie. Returns new `{ token }`. Family revocation on replay. Rate limited (30 / 15 min / IP). |
| `POST` | `/auth/logout` | Bearer | Revoke current refresh session, clear cookie. |
| `POST` | `/auth/logout-all` | Bearer | Revoke **all** refresh sessions for the user. |
| `GET` | `/auth/me` | Bearer | Current user with role, department, restrictions, manager dashboard fields. |
| `PATCH` | `/auth/profile` | Bearer | Update profile fields. If email changes, bumps `authVersion` and re-issues tokens. |
| `POST` | `/auth/profile/avatar` | Bearer | Upload avatar image (`multipart/form-data`, field `file`). MIME allowlist + magic-byte check, 2 MB limit. |
| `DELETE` | `/auth/profile/avatar` | Bearer | Remove avatar. |
| `POST` | `/auth/change-password` | Bearer | Change password. Rejects same-password reuse, bumps `authVersion`, revokes sessions. Rate limited (10 / 15 min / IP). |
| `POST` | `/auth/forgot-password` | No | Request password-reset email. Timing-attack safe (500 ms + jitter). Rate limited (8 / hour / IP). |
| `POST` | `/auth/reset-password` | No | Complete reset with `{ token, newPassword }`. Rate limited (10 / 15 min / IP). |

### Documents (`/documents`)

All endpoints require `authenticateToken` + `requireDocLibraryAccess` unless noted.

| Method | Path | Extra auth | Description |
|--------|------|------------|-------------|
| `POST` | `/documents/upload` | `requireManageDocumentsCapability` | Upload new document (multipart). Creates document + version 1, enqueues ingest, optionally notifies department. |
| `GET` | `/documents/tags/suggestions` | — | Tag autocomplete. |
| `GET` | `/documents/export` | **ADMIN** | CSV export of filtered document list (formula-injection escaped). |
| `POST` | `/documents/bulk-delete` | **ADMIN** + manage | Transactional bulk delete with storage cleanup. |
| `GET` | `/documents` | — | Paginated library list with scoped visibility (readable departments). |
| `PATCH` | `/documents/:documentId` | manage | Update metadata, tags, visibility. Optional department notification. |
| `POST` | `/documents/:documentId/view` | — | Record view (recents + audit `VIEWED`). |
| `POST` | `/documents/:documentId/favorite` | — | Add to favorites (audit `FAVORITED`). |
| `DELETE` | `/documents/:documentId/favorite` | — | Remove from favorites (audit `UNFAVORITED`). |
| `POST` | `/documents/:documentId/archive` | manage | Archive document. |
| `DELETE` | `/documents/:documentId/archive` | manage | Unarchive document. |
| `GET` | `/documents/:documentId/audit` | view audit permission | Audit log entries for this document. |
| `GET` | `/documents/:documentId` | read access | Document detail JSON (versions, tags, metadata). |
| `POST` | `/documents/:documentId/versions/:versionId/reprocess` | manage | Reset chunks, re-enqueue ingest. |
| `POST` | `/documents/:documentId/versions` | manage | Upload new version (multipart). Creates version row, enqueues ingest. |
| `GET` | `/documents/:documentId/versions/:versionId/file` | read access | Stream/download file. Supports `?inline=` for preview. |
| `DELETE` | `/documents/:documentId` | manage | Delete document + all versions + storage files. |

### Search (`/search`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/search/semantic` | Bearer + `requireUseAiQueries` | Body: `{ "query": string, "limit"?: 1–50, "optimize"?: boolean }`. Vector search with department-scoped access filters; `optimize: true` rewrites `query` before embedding (same optimizer as ask). |
| `POST` | `/search/ask` | Bearer + `requireUseAiQueries` | Full RAG pipeline (SSE). Body: `{ "question": string, "chunkLimit"?: 1–30, "history"?: ChatTurn[], "filters"?: { mimeTypes?, tags?, documentIds?, createdAfter?, createdBefore? }, "useHyde"?: boolean }`. Rate limited (12 / min / IP). |

#### `POST /search/ask` SSE events

Response `Content-Type: text/event-stream`.

| Event | Payload |
|-------|---------|
| `sources` | Citations, `confidence`, **`topic`**, **`rewrittenQuery`**, **`queryType`**, **`promptVariant`** (A/B label when a flag is set) |
| `token` | `{ token: string }` — streamed answer fragments |
| `correction-token` | Optional streamed tokens for a replacement answer during critique |
| `correction` | Optional final corrected answer + issue metadata |
| `warning` | Human-readable quality or verification warnings |
| `verification` | Per-claim faithfulness results from `claimVerifier.ts` |
| `followups` | `{ followUps: string[] }` — suggested next questions |
| `done` | `{ done: true }` — stream complete |

### Conversations (`/conversations`)

All endpoints require `authenticateToken`.

| Method | Path | Extra auth | Description |
|--------|------|------------|-------------|
| `GET` | `/conversations` | — | List user conversations (previews). |
| `GET` | `/conversations/feedback/stats` | **ADMIN** | Aggregated answer feedback statistics and weak-area analysis. |
| `GET` | `/conversations/:id` | owner | Conversation detail with messages. |
| `POST` | `/conversations` | — | Create new conversation. |
| `POST` | `/conversations/:id/messages` | owner | Append message (triggers AI reply). |
| `POST` | `/conversations/:id/generate-title` | owner + `requireUseAiQueries` | AI-generated conversation title. |
| `PATCH` | `/conversations/:id` | owner | Update conversation (e.g. rename). |
| `POST` | `/conversations/:id/messages/:messageId/feedback` | owner | Submit thumbs-up/down rating + optional comment. |
| `DELETE` | `/conversations/:id/messages/:messageId/feedback` | owner | Remove feedback. |
| `DELETE` | `/conversations/:id` | owner | Delete conversation and cascade messages. |

### Manager (`/manager`)

Router-level: `authenticateToken` + `requireManagerDashboardAccess`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/manager/departments` | Departments the user may manage (from role + `UserDepartmentAccess`). |
| `GET` | `/manager/department` | Detail for a selected managed department (`?departmentId`), including members. |

### Admin (`/admin`)

All endpoints require `authenticateToken` + `requireRole(ADMIN)`.

**Departments:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/departments` | List all departments (hierarchy, member previews). |
| `GET` | `/admin/roles` | List all roles. |
| `POST` | `/admin/departments` | Create department. |
| `PATCH` | `/admin/departments/:departmentId` | Update department name/parent. |
| `DELETE` | `/admin/departments/:departmentId` | Delete department (serializable tx with usage checks). |
| `POST` | `/admin/departments/merge` | Merge two departments (transactional: reassign access, users, documents, delete source). |

**Users:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users` | List/filter users. |
| `POST` | `/admin/users` | Create user. |
| `PATCH` | `/admin/users/:userId` | Update user fields (may bump `authVersion`). Last-admin safety check on role change. |
| `POST` | `/admin/users/:userId/avatar` | Upload avatar for a user. |
| `DELETE` | `/admin/users/:userId/avatar` | Clear user avatar. |
| `POST` | `/admin/users/bulk-restrictions` | Bulk toggle restriction flags for multiple users. |
| `POST` | `/admin/users/import` | Bulk import users from structured payload. |
| `POST` | `/admin/users/:userId/reset-restrictions` | Reset all restriction flags to allowed. |
| `POST` | `/admin/users/:userId/revoke-sessions` | Revoke all refresh sessions + bump `authVersion`. |
| `POST` | `/admin/users/:userId/set-password` | Admin sets a new password for a user. |
| `POST` | `/admin/users/:userId/lock` | Lock account (`loginLockedUntil`). |
| `POST` | `/admin/users/:userId/unlock` | Unlock account. |
| `POST` | `/admin/users/:userId/restore` | Restore a soft-deleted user. |
| `DELETE` | `/admin/users/:userId` | Hard delete user (last-admin safety check). |

**Department access (multi-department):**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users/:userId/department-access` | List access rows for a user. |
| `POST` | `/admin/users/:userId/department-access` | Upsert one department assignment (`MEMBER` / `MANAGER` / `VIEWER`). |
| `PUT` | `/admin/users/:userId/department-access` | Replace **all** assignments for a user (bulk body). |
| `DELETE` | `/admin/users/:userId/department-access/:departmentId` | Remove one assignment. |
| `GET` | `/admin/departments/:departmentId/access` | List users with access to a specific department. |

**Stats, activity, and audit:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/stats` | Dashboard KPI aggregates. |
| `GET` | `/admin/stats/kpis` | KPI definitions/metadata. |
| `GET` | `/admin/stats/kpis/:kpiId/timeseries` | KPI time series data. |
| `GET` | `/admin/document-audit` | Paginated document audit log. |
| `GET` | `/admin/document-audit/export` | CSV export of document audit (formula-injection escaped). |
| `GET` | `/admin/activity` | Paginated auth events (login, logout, password changes, etc.). |
| `GET` | `/admin/activity/export` | CSV export of auth activity. |

### Notifications (`/notifications`)

All endpoints require `authenticateToken`.

| Method | Path | Extra auth | Description |
|--------|------|------------|-------------|
| `GET` | `/notifications?page=1&limit=20` | — | Paginated inbox with actor details and attachment metadata. |
| `GET` | `/notifications/unread-count` | — | `{ unreadCount: number }` for bell icon badge. |
| `PATCH` | `/notifications/:id/read` | — | Mark one notification as read. |
| `PATCH` | `/notifications/read-all` | — | Mark all notifications as read. |
| `POST` | `/notifications/send` | **ADMIN** or **MANAGER** | Send manual notification (`multipart/form-data`): `title`, `body`, `targetType` (`ALL_USERS` / `DEPARTMENT` / `ROLE`), optional `targetDepartmentId`, `targetRoleName`, `attachment`. Managers limited to their managed departments. |
| `GET` | `/notifications/:notificationId/attachment` | recipient | Stream attachment download with correct MIME and `Content-Disposition`. |
| `DELETE` | `/notifications/:id` | — | Delete notification from user's list. |

---

## Web application (routes)

All pages are under `apps/web/app/` using the Next.js 15 **App Router** convention.

| Route | Description |
|-------|-------------|
| `/` | Client gate: anonymous users redirect to `/login`; signed-in users redirect to their role-appropriate home via `homePathForUser()` (`HomeEntryClient`). |
| `/login` | Login form. |
| `/register` | Static "no self-registration" informational page. |
| `/forgot-password` | Password-reset request form. |
| `/reset-password` | Token-based password reset form. |
| `/dashboard` | Main dashboard — adaptive card grid (Documents, Ask, Department overview, Administration) based on role and restrictions. 2-column for even card count, 3-column for odd. |
| `/documents` | Document library browser with filters, tags, favorites, and inline PDF/image preview modals. |
| `/documents/search` | Semantic search interface. |
| `/documents/ask` | RAG chat UI: streaming markdown, **[Source N]** citation anchors, source-card hover preview, **confidence** badge, **follow-up chips**, thumbs with optional **downvote comment**, conversation history. |
| `/documents/[documentId]` | Document detail view (versions, tags, audit, metadata editing, download). |
| `/profile` | User profile (avatar, name, email, badge, password change). |
| `/manager` | Manager dashboard — managed departments and member lists. |
| `/admin` | Admin hub with card navigation to sub-modules. |
| `/admin/users` | User management (CRUD, restrictions, import, lock/unlock, sessions, department access). |
| `/admin/departments` | Department management (CRUD, merge, hierarchy, access). |
| `/admin/documents` | Admin document oversight and bulk operations. |
| `/admin/activity` | Auth activity log (logins, password changes, lockouts) with CSV export. |
| `/admin/document-audit` | Document audit log with CSV export. |
| `/admin/system` | System health and configuration overview. |
| `/about` | About / platform information page. |
| `/contact` | Contact information page. |
| `/restricted` | Explains blocked features when restriction flags are active. Reads `?feature=` from query string. |

### Loading and error boundaries

| File | Route scope | Behavior |
|------|-------------|----------|
| `app/loading.tsx` | Root | `RouteLoadingShell` with shimmer animation ("Loading…"). |
| `app/dashboard/loading.tsx` | `/dashboard` | "Loading dashboard…" shell. |
| `app/documents/loading.tsx` | `/documents/*` | "Loading documents…" shell. |
| `app/admin/loading.tsx` | `/admin/*` | "Loading admin…" shell. |
| `app/error.tsx` | All routes | Client error boundary with "Try again" button and link to `/dashboard`. |
| `app/layout.tsx` | Root layout | Metadata, `skip-to-content` link, `Providers` wrapper, `main#main-content`. |

### Next.js middleware

`apps/web/middleware.ts` behavior:
- **Production:** passes through (`NextResponse.next()`). No server-side auth gating (refresh cookie is scoped to the API origin, not sent to Next).
- **Development:** sets `Cache-Control: no-store, no-cache, must-revalidate, max-age=0` on HTML navigations to avoid stale `/_next/static` references after `.next` cache clears.
- **Matcher:** excludes `_next/static`, `_next/image`, `favicon.ico`, `icon.svg`, `logo.svg`.

---

## Frontend internals

### Component inventory (`apps/web/components/`)

| Component | File | Role |
|-----------|------|------|
| `Providers` | `Providers.tsx` | Root wrapper: composes `ThemeProvider` (next-themes), `ToastProvider`, `ConfirmProvider`, `NotificationProvider`; mounts `NotificationPanel`. |
| `ThemeToggleMenu` | `ThemeToggle.tsx` | Segmented Light / Dark / System selector for authenticated pages (dashboard, documents, ask, profile, admin/manager chrome). |
| `ThemeToggleCorner` | `ThemeToggle.tsx` | Compact icon-based theme toggle for auth pages (login, register, forgot/reset password). |
| `Toast` / `ToastProvider` / `useToast` | `Toast.tsx` | Global toast queue (max ~5 visible). Types: info, success, error, warning. Slide-in/out animations, auto-dismiss. |
| `ConfirmDialog` / `ConfirmProvider` / `useConfirm` | `ConfirmDialog.tsx` | Promise-based modal confirm replacing native `confirm()`. Keyboard Escape, focus management, danger mode, `aria-modal`. |
| `RouteLoadingShell` | `RouteLoadingShell.tsx` | Accessible loading skeleton with shimmer animation (`kp-route-loading` classes). Used by `loading.tsx` files. |
| `Spinner` | `Spinner.tsx` | Inline SVG animated spinner with `role="status"` and configurable `size`. |
| `AuthCard` | `AuthCard.tsx` | Centered card layout for login/register/reset screens: logo, title, subtitle, body, footer. |
| `NotificationContext` / `NotificationProvider` / `useNotifications` | `NotificationContext.tsx` | Notification state: polls unread count (10 s), lists/loads notifications, mark read/delete; skips on public auth pages. |
| `NotificationBell` | `NotificationBell.tsx` | Bell icon button in nav bar; toggles `NotificationPanel`; unread badge. |
| `NotificationPanel` | `NotificationPanel.tsx` | Slide-over panel: notification list with infinite scroll, detail overlay, attachment download, "Mark all read". |
| `SendNotificationModal` | `SendNotificationModal.tsx` | In-panel form for admins/managers to compose announcements with optional file attachment. |
| `UserAvatarNavButton` | `UserAvatarNavButton.tsx` | Nav button: renders avatar via `ProfileAvatarImage` or initials fallback. |
| `ProfileAvatarImage` | `ProfileAvatarImage.tsx` | Circular `<img>` with error fallback to initials (intentionally avoids `next/image`). |
| `ProfilePhotoUploader` | `ProfilePhotoUploader.tsx` | Inline upload + dropzone for self or admin avatar upload/delete; calls API avatar endpoints. |
| `ProfilePhotoModal` | `ProfilePhotoModal.tsx` | Modal for photo management: upload, drag-drop, URL field, `PATCH` profile, remove — supports self and admin modes. |
| `ClientLocaleDate` / `ClientLocaleTime` | `ClientLocaleDate.tsx` | Renders locale-formatted dates/times after mount to prevent SSR hydration mismatches. |
| `FileTypeIcon` | `FileTypeIcon.tsx` | SVG file-type icons by extension (PDF, DOC, XLS, image, etc.) with variants: `card`, `row`, `detail`. Uses CSS vars like `--file-icon-pdf`. |

### Lib modules (`apps/web/lib/`)

| Module | Exports | Role |
|--------|---------|------|
| `apiBase.ts` | `API_BASE` | Resolved `NEXT_PUBLIC_API_URL` (falls back to `http://localhost:3001`). Used as prefix for all API calls. |
| `authClient.ts` | `setAccessToken`, `clearStoredSession`, `fetchPublicApi`, `refreshAccessToken`, `getValidAccessToken`, `signOut`, `fetchWithAuth`, `fetchWithAuthStreaming` | Central token lifecycle: stores access token in-memory, single-flight refresh promise to prevent rotation races, authenticated fetch with auto-refresh on 401, streaming fetch for SSE (no 20 s timeout). `KP_AUTH_SESSION_REFRESHED` event for cross-tab coordination. |
| `restrictions.ts` | `RoleNameApi`, `DepartmentAccessLevelApi`, `MeUserDto`, `UserRestrictionsDto`, `restrictedHref`, `userCanOpenManagerDashboard`, `homePathForUser` | Role and restriction enums matching the API contract, user DTO types, role-aware home routing, helper to build `/restricted?feature=…` URLs. |
| `fileToAvatarBlob.ts` | `fileToAvatarBlob` | Client-side image resizing via `createImageBitmap` + canvas. Outputs JPEG blob. Enforces 25 MB input limit. |
| `profilePicture.ts` | `profilePictureDisplayUrl`, `hasProfilePicture`, `userInitialsFromName` | Avatar URL resolution (prepends `API_BASE`), fallback initials from first/last name. |

### Next.js config (`next.config.ts`)

- **Bundle analyzer:** `@next/bundle-analyzer` wraps the config; enabled with `ANALYZE=true` (used by `npm run analyze:web`).
- **Rewrites:** `GET /favicon.ico` → `/icon.svg` (avoids App Router segment issues).
- **Headers (all routes):** CSP (see [Transport and headers](#transport-and-headers)), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- **`experimental.devtoolSegmentExplorer: false`** — avoids a Windows dev bug with the RSC segment explorer manifest.

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

| Variable | Required / typical | Default | Purpose |
|----------|-------------------|---------|---------|
| `DATABASE_URL` | **Required** | — | PostgreSQL connection string (e.g. `postgresql://user:pass@localhost:5432/knowledge_platform`) |
| `JWT_SECRET` | **Required** (min 32 chars) | `dev-only-…` in non-prod | Signing access tokens (HS256). Generate with `openssl rand -hex 32`. In production the API exits at startup if missing or < 32 chars. |
| `JWT_EXPIRES_IN` | Optional | `15m` | Access token TTL. Accepts any `ms`-compatible string (e.g. `15m`, `1h`). |
| `REFRESH_TOKEN_TTL_DAYS` | Optional | `30` | Refresh token / session lifetime in days. |
| `GEMINI_API_KEY` | Required for ingest + RAG | — | Embeddings, optimization, rerank, answers. Without this, ingest and `/search/ask` return 503. |
| `GEMINI_EMBEDDING_MODEL` | Optional | `gemini-embedding-001` | Embedding model for ingest + semantic search. |
| `GEMINI_CHAT_MODEL` | Optional | `gemini-2.5-flash` | Chat model for query optimization, reranking, streaming answers. |
| `REDIS_URL` | Optional | `redis://127.0.0.1:6379` | Redis for BullMQ queue, rate limiters, and `/health` check. |
| `PORT` | Optional | `3001` | HTTP listen port. |
| `PUBLIC_API_URL` | Strongly recommended | — | Public base URL of API (no trailing slash). Used for avatar URLs and links in emails. Should match what the browser uses. |
| `WEB_APP_URL` | **Required** when `NODE_ENV=production` | `http://localhost:3000` | Web origin(s) for CORS and password-reset emails (comma-separated for multiple origins). API exits at startup if missing in production. |
| `NODE_ENV` | Auto-set | `development` | `production` enables JSON logging, enforces JWT_SECRET minimum, suppresses debug messages in error responses, requires `WEB_APP_URL`. |
| `TRUST_PROXY` | Optional | — | Express trust proxy value. Set to hop count (e.g. `1`) or subnet behind a reverse proxy. Avoid `true` in production. |
| `STORAGE_PATH` | Optional | `<cwd>/uploads` | Upload directory for documents, avatars, and notification attachments. |
| `CHUNK_SIZE_CHARS` | Optional | `3200` | Target chunk size in characters for document text splitting. Minimum 200. |
| `CHUNK_OVERLAP_CHARS` | Optional | `400` | Overlap between consecutive chunks. Minimum 0. |
| `CHUNK_MAX_CHARS` | Optional | `5000` | Hard upper bound for a single chunk. Minimum 500. |
| `RAG_FUSE_DEPTH` | Optional | `30` | Chunks retrieved per leg (vector / BM25) before fusion; ask body `chunkLimit` overrides for that request. |
| `RAG_RERANK_DEPTH` | Optional | `20` | Top-N after RRF sent to the LLM reranker. |
| `RAG_CONTEXT_CHUNKS` | Optional | `6` | Top-N chunks after rerank (+ neighbor expansion) passed to generation. |
| `RAG_RERANK_PASSAGE_CHARS` | Optional | `3000` | Max characters per passage shown to the reranker model. |
| `RRF_DENSE_WEIGHT` / `RRF_SPARSE_WEIGHT` | Optional | `100` each | Integer weights ÷ 100 for vector vs BM25 in weighted RRF. |
| `RRF_K` | Optional | `60` | RRF `k` constant. |
| `RAG_USE_HYDE` | Optional | `false` | Global default for HyDE vector queries; per-request `useHyde` still applies when `true`. |
| `RAG_ITERATIVE_CRITIQUE` | Optional | `true` | Allow critique even when the first answer looks acceptable. |
| `RAG_MAX_CRITIQUE_ROUNDS` | Optional | `2` | Upper bound on critique iterations. |
| `RAG_ANSWER_CACHE_TTL` | Optional | `3600` | Final-answer cache TTL in seconds; `0` disables. |
| `RAG_MUST_EXCLUDE_PENALTY` | Optional | `30` | Penalty ×0.01 applied to chunks matching any must-exclude optimizer term. |
| `RAG_PROMPT_VERSION` | Optional | `v3` | Bumped to invalidate answer cache when system prompts change. |
| `RAG_SEMANTIC_CHUNK` | Optional | `false` | Enable embedding-based re-splitting for oversized chunk candidates at ingest. |
| `RAG_NEIGHBOR_EXPANSION` | Optional | `true` | Pull adjacent chunks in the same version after rerank. |
| `FLAG_<NAME>` | Optional | — | A/B weights, e.g. `FLAG_PROMPT=v2:1,v3:1` (see `featureFlags.ts`). |
| `SUPPORT_CONTACT_MESSAGE` | Optional | `"If you believe this is a mistake, contact your IT administrator or help desk."` | Message shown to restricted users on 403 / restricted pages. |
| `SMTP_HOST` | Optional | — | SMTP server hostname. If unset in dev, password-reset links log to console. |
| `SMTP_PORT` | Optional | `587` | SMTP port. |
| `SMTP_SECURE` | Optional | `false` | Set `true` for implicit TLS (port 465). When `false`, STARTTLS upgrade is enforced (`requireTLS: true`). |
| `SMTP_USER` | Optional | — | SMTP authentication username. |
| `SMTP_PASS` | Optional | — | SMTP authentication password. |
| `SMTP_FROM` | Optional | `SMTP_USER` value | Sender address for password-reset emails. |
| `SEED_ADMIN_EMAIL` | Optional | `admin@example.com` | Admin email created by seed script. |
| `SEED_ADMIN_PASSWORD` | Optional | `ChangeMe123!` | Admin password created by seed script. |
| `SEED_*` | Optional | — | Additional seed overrides: `SEED_UX_DEPARTMENT_NAME`, `SEED_BACKOFFICE_DEPARTMENT_NAME`, `SEED_MANAGER_EMAIL`, `SEED_MANAGER_PASSWORD`, `SEED_MANAGER_NAME`, `SEED_MANAGER_DEPARTMENT_NAME`, `SEED_MANAGER_POSITION`, `SEED_UX_EMPLOYEE_EMAIL`, `SEED_UX_EMPLOYEE_PASSWORD`, `SEED_UX_EMPLOYEE_NAME`, `SEED_UX_EMPLOYEE_BADGE`, `SEED_UX_EMPLOYEE_POSITION`. |

See `apps/api/.env.example` for the full list and inline comments.

### Web (`apps/web/.env.local`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Browser-visible API base URL (no trailing slash). Must align with API's `PUBLIC_API_URL`. |

### Dev script overrides (read by `scripts/dev-api.mjs` and `scripts/dev-web.mjs`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_PORT` | `3001` | Override the API listen port in development. |
| `WEB_PORT` | `3000` | Override the Next.js dev server port. |

### Docker Compose production (`docker-compose.prod.yml`)

These variables are consumed by the production compose file. Set them in a `.env` file at repository root or in your deployment environment.

| Variable | Required | Purpose |
|----------|----------|---------|
| `POSTGRES_USER` | Yes | PostgreSQL superuser name. |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL superuser password. |
| `REDIS_PASSWORD` | Yes | Redis `requirepass` value. |
| `JWT_SECRET` | Yes | ≥ 32 characters. |
| `WEB_APP_URL` | Yes | Production web origin for CORS. |
| `NEXT_PUBLIC_API_URL` | Yes | Public API URL baked into the web image at build time. |
| `GEMINI_API_KEY` | Yes (for RAG) | Gemini API key. |
| `POSTGRES_PORT` | No (default `5432`) | Host-side Postgres port. |
| `REDIS_PORT` | No (default `6379`) | Host-side Redis port. |
| `API_PORT` | No (default `3001`) | Host-side API port. |
| `WEB_PORT` | No (default `3000`) | Host-side web port. |
| `SMTP_*` | No | Same SMTP variables as the API table above. |
| `TRUST_PROXY` | No | Same as the API table above. |

---

## Scripts (repository root)

| Script | Description |
|--------|-------------|
| `npm run dev` | API + web together via `concurrently` (Webpack dev server for Next by default). Spawns `scripts/dev-api.mjs` and `scripts/dev-web.mjs`. |
| `npm run dev:turbo` | Same with Next Turbopack (`NEXT_TURBOPACK_DEV=1`). |
| `npm run dev:api` / `npm run dev:web` | Run one side only. |
| `npm run dev:clean` | Clean Next cache then `dev`. |
| `npm run clean:web` | Remove `apps/web/.next` (`scripts/clean-web-next.mjs`). |
| `npm run build` / `npm run verify` | Production builds — API `tsc` then web `next build`. `verify` is an alias of `build`. |
| `npm run analyze:web` | Next.js build with `@next/bundle-analyzer` output (`ANALYZE=true`). |
| `npm run test:api` | Vitest integration + unit tests (needs DB + migrated schema + Redis). |
| `npm run lint` | Web `next lint` + API `tsc --noEmit`. |
| `npm run lint:api` | ESLint on `apps/api/src` with the flat config (`apps/api/eslint.config.mjs`). |
| `npm run format` | Prettier — write-format all files. |
| `npm run format:check` | Prettier — check formatting without writing. |
| `npm run db:migrate` | `prisma migrate deploy` in API workspace. |
| `npm run db:generate` | `prisma generate` in API workspace. |
| `npm run db:seed` | Seed roles, departments, sample users. |
| `npm run docker:up` / `docker:down` | Compose Postgres + Redis (dev infra); full `docker compose up --build` also builds API + Web images. |
| `npm run eval:rag` | Full RAG eval suite + JSON report under `apps/api/eval-reports/` (API workspace). |
| `npm run eval:rag:quick` | Shorter eval pass for fast smoke checks. |
| `npm run eval:rag:baseline` | Full eval and **write baseline** metrics for regression comparison. |
| `npm run reindex:doc` / `reindex:all` | Re-enqueue ingest for one/many/all documents (see `src/scripts/reindex.ts`). |
| `npm run export:feedback` | Export recent **thumbs-up** answers as candidate eval cases (`eval-reports/feedback-candidates-*.json`). |
| `./scripts/backup-db.sh [dir]` | Database backup: `pg_dump` + gzip to `./backups/` (or custom dir). Retains last 30 backups. Reads `DATABASE_URL` or `PG*` vars. |

API **`npm run build`** excludes `*.test.ts` from `tsc` output (via `tsconfig.json` exclude); tests run separately with **`npm run test:api`**.

---

## Code style and formatting

### Prettier

Configuration in `.prettierrc` at repository root:

| Setting | Value |
|---------|-------|
| Semicolons | Yes |
| Quotes | Double (`"`) |
| Trailing commas | `all` |
| Tab width | 2 |
| Print width | 100 |
| Bracket spacing | Yes |
| Arrow parens | Always |
| End of line | `lf` |

`.prettierignore` excludes `node_modules`, `dist`, `.next`, `coverage`, `*.tsbuildinfo`, `apps/api/prisma/migrations`, and `package-lock.json`.

Run formatting:

```bash
npm run format          # write all files
npm run format:check    # check without writing (CI-friendly)
```

### ESLint

Each workspace has its own config:

- **API** (`apps/api/eslint.config.mjs`): ESLint flat config with `@eslint/js` recommended + `typescript-eslint` recommended. Parser uses the API `tsconfig.json`. Rules: `no-unused-vars` (warn, `^_` ignored), `no-explicit-any` (warn), `no-console` (warn). Ignores `dist/`, `node_modules/`, `*.js`, `*.mjs`.
- **Web** (`apps/web`): Uses `eslint-config-next` (Next.js defaults). Run via `npm run lint` at root.

```bash
npm run lint        # web (next lint) + API (tsc --noEmit)
npm run lint:api    # ESLint on apps/api/src only
```

### TypeScript

- **API:** `target: ES2022`, `module: NodeNext` (ESM), `strict: true`, output to `dist/`. Tests (`*.test.ts`) excluded from `tsc` build.
- **Web:** `target: ES2017`, `module: esnext`, `moduleResolution: bundler`, `jsx: preserve`, `strict: true`, `noEmit: true` (Next.js handles compilation). Path alias `@/*` → `./*`.

---

## Production deployment notes

### Option A: Docker — development compose (`docker-compose.yml`)

Quickest way to run everything locally with fixed credentials:

```bash
docker compose up -d --build
```

Services: `postgres` (pgvector/pg16), `redis` (7-alpine), `api`, `web`. Postgres credentials are hardcoded (`postgres`/`postgres`), Redis has no password, and `JWT_SECRET` must be provided in a `.env` file or environment. `NEXT_PUBLIC_API_URL` and `PUBLIC_API_URL` are baked as build args for the web image.

### Option B: Docker — production compose (`docker-compose.prod.yml`)

The production compose file adds security hardening and persistent storage:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

| Feature | Detail |
|---------|--------|
| **Redis authentication** | `--requirepass` from `REDIS_PASSWORD` (required). `REDIS_URL` for the API includes the password. |
| **Persistent upload volume** | Named volume `api_uploads` mounted at `/app/uploads` so uploaded documents survive container restarts. |
| **Full API env surface** | Accepts all production vars: `GEMINI_*`, `SMTP_*`, `TRUST_PROXY`, `PUBLIC_API_URL`, `STORAGE_PATH=/app/uploads`. |
| **Per-service port overrides** | `POSTGRES_PORT`, `REDIS_PORT`, `API_PORT`, `WEB_PORT` default to standard values; override in `.env`. |
| **Required secrets** | `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `WEB_APP_URL`, `NEXT_PUBLIC_API_URL` all fail fast if missing. |

### Docker image details

**API image** (`apps/api/Dockerfile`) — 3-stage build on `node:22-alpine`:

1. **deps** — `npm ci` for the `@knowledge-platform/api` workspace.
2. **build** — `prisma generate` + `tsc` (produces `dist/`).
3. **final** — copies `node_modules`, `dist`, `prisma/`, and `.prisma` client. Creates `/app/uploads` owned by `node`. Runs as non-root `node` user.

- **Entrypoint** (`docker-entrypoint.sh`): runs `npx prisma migrate deploy` **automatically** on every container start (applies pending migrations before the API process begins), then `exec node apps/api/dist/index.js`.
- **Health check:** `wget --spider http://localhost:3001/health` every 30 s.

**Web image** (`apps/web/Dockerfile`) — 4-stage build on `node:22-alpine`:

1. **deps** — `npm ci` for the `@knowledge-platform/web` workspace.
2. **build** — `next build` with `NEXT_PUBLIC_API_URL` and `PUBLIC_API_URL` baked as build args.
3. **pruned** — `npm prune --omit=dev` to strip devDependencies.
4. **final** — copies pruned `node_modules`, `.next`, `public`. Runs as `node` user.

- **Health check:** `wget --spider http://localhost:3000/` every 30 s.
- **CMD:** `npm run start -w @knowledge-platform/web` (`next start`).

### Option C: Manual deployment

- Set strong **`JWT_SECRET`** (minimum 32 characters, generated with `openssl rand -hex 32`), production **`DATABASE_URL`**, **`REDIS_URL`**, **`GEMINI_API_KEY`**, and **`PUBLIC_API_URL`** / **`NEXT_PUBLIC_API_URL`** to real public hostnames.
- Set **`WEB_APP_URL`** to the production web origin (required with `NODE_ENV=production`; the API exits at startup if missing).
- Set **`TRUST_PROXY`** to your reverse proxy hop count or subnet (e.g. `1` or `"loopback"`). Avoid `true` as it trusts all `X-Forwarded-For` headers unconditionally.
- Run **`npm run db:migrate`** against the production database before rolling out API versions that change schema.
- Build and serve **web** with `next build` + `next start` (or your host's equivalent).
- Run **API** with `node dist/index.js` after `npm run build` in `apps/api`.

### Database backup

A backup script is provided at `scripts/backup-db.sh`:

```bash
./scripts/backup-db.sh              # writes to ./backups/
./scripts/backup-db.sh /mnt/backup  # custom output directory
```

- Requires `pg_dump` and `gzip`.
- Reads `DATABASE_URL` (or individual `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` vars).
- Output: timestamped `kp_backup_YYYYMMDD_HHMMSS.sql.gz`.
- Automatically prunes backups older than the latest 30.

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

### Framework and configuration

Tests use **Vitest** (`apps/api/vitest.config.ts`) with the following settings:

| Setting | Value | Why |
|---------|-------|-----|
| `environment` | `node` | Tests run in Node, not jsdom. |
| `globals` | `true` | `describe`, `it`, `expect` available globally. |
| `include` | `src/**/*.test.ts`, `src/**/*.integration.test.ts` | Both unit and integration tests. |
| `fileParallelism` | `false` | Tests run sequentially to avoid database conflicts. |
| `testTimeout` | `60000` (60 s) | Long timeout for integration tests that hit real DB/Redis. |
| `setupFiles` | `./src/vitest.setup.ts` | Loads `dotenv/config` and patches async error handling. |

HTTP integration tests use **Supertest** against the Express app created by `createHttpApp()` (no live server needed).

### Test files

| File | Scope | What it covers |
|------|-------|----------------|
| `health.integration.test.ts` | Root | `GET /`, `GET /health`, 404 for unknown routes. |
| `auth.integration.test.ts` | Auth | Login (success, failures, lockout), refresh (cookie-based rotation, replay detection), `GET /me`, `PATCH /profile`, change password (same-password block, `authVersion` bump), `POST /logout-all`. |
| `admin.integration.test.ts` | Admin | User CRUD, department CRUD, merge, bulk restrictions, department access management, stats, activity, audit. |
| `documents.integration.test.ts` | Documents | Upload, list, detail, metadata update, favorites/recents, versioning, reprocess, delete, visibility enforcement. |
| `manager.integration.test.ts` | Manager | List managed departments, department detail + members. |
| `notifications.integration.test.ts` | Notifications | Send manual notification, inbox list, unread count, mark read, attachment download, delete. |
| `search.integration.test.ts` | Search | Semantic search, ask (SSE), access filtering. |
| `conversations.integration.test.ts` | Conversations | CRUD, messages, feedback, title generation. |
| `lib/roleNameContract.test.ts` | Unit | Validates that Prisma `RoleName` enum values match the web client's `RoleNameApi` constants. |

Integration tests expect a **seeded database** (roles, departments, users) and a running **Redis** instance.

### CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs **four parallel jobs** on every push/PR to `main` or `master`:

| Job | What it does |
|-----|-------------|
| **Lint** | `next lint` on the web package, `tsc --noEmit` on the API. |
| **Audit** | `npm audit --omit=dev --audit-level=high` for dependency vulnerabilities. |
| **Typecheck & Build** | `prisma generate`, `tsc` (API) + `next build` (Web) with placeholder API URLs. |
| **Test** | Spins up **Postgres (pgvector)** + **Redis** service containers, runs migrations against a test database (`knowledge_platform_test`), executes `npx vitest run --coverage` with `NODE_ENV=test`. |

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

### Prisma generate fails with `EPERM` on Windows (`query_engine-windows.dll.node`)

Another process (often a running API or test runner) has the Prisma engine file locked. Stop all **Node** processes using the API workspace, then run `npm run db:generate` again.

---

## RAG evaluation and tuning

- **Cases** live in code as `EVAL_CASES` (and related structures) inside `apps/api/src/lib/ragEvaluation.ts` — version-controlled ground-truth style checks.
- **Harness** — `ragHarness.ts` runs the production retrieval + generation path (or subsets) against those cases.
- **Judge** — `ragJudge.ts` scores answers (faithfulness, coverage, style) and aggregates metrics into JSON.
- **CLI** — `npm run eval:rag` (full), `npm run eval:rag:quick`, `npm run eval:rag:baseline` (writes baseline for regressions). Reports are written to **`apps/api/eval-reports/`** (folder is kept in repo with `.gitkeep`; large generated JSON files should be reviewed before committing).
- **Workflow** — Tune `RAG_*` / `RRF_*` env vars → run eval → compare reports → ship. Use **`npm run export:feedback`** to promote real thumbs-up transcripts into **candidate** cases for human review before merging into `EVAL_CASES`.

---

## Operational CLIs (reindex, feedback export)

| Command | Purpose |
|---------|---------|
| `npm run reindex:doc -- <documentId> …` | Re-chunk and re-embed specific documents using the existing BullMQ ingest worker. |
| `npm run reindex:doc -- --version <versionId>` | Target a single `DocumentVersion` row. |
| `npm run reindex:all` | Re-index every document’s latest version (`--wait` optional to block until the queue drains). |
| `npm run export:feedback` | Emit `eval-reports/feedback-candidates-<timestamp>.json` from positive `AnswerFeedback` rows (flags: see script header in `exportFeedback.ts`). |

Requires a running **Redis** and valid **`DATABASE_URL`** / **`GEMINI_API_KEY`** where the operation needs the worker or embeddings.

---

## Documentation hub (diagrams & UML)

Product and technical diagrams live under **[docs/](docs/README.md)**, organized by diagram type:

| Folder | Contents |
|--------|----------|
| [`docs/diagrams/architecture/`](docs/diagrams/architecture/) | System / deployment diagram — **[platform-architecture.puml](docs/diagrams/architecture/platform-architecture.puml)** |
| [`docs/diagrams/sequence/`](docs/diagrams/sequence/) | 41 PlantUML **sequence** diagrams (`seq-01` … `seq-41`) covering every API flow — [index](docs/diagrams/sequence/README.md) |
| [`docs/diagrams/use-case/`](docs/diagrams/use-case/) | Global **use case** narrative + [global-use-case-diagram.puml](docs/diagrams/use-case/global-use-case-diagram.puml) |
| [`docs/diagrams/class/`](docs/diagrams/class/) | Domain / **class** model narrative + [global-class-diagram.puml](docs/diagrams/class/global-class-diagram.puml) |

Other docs:

- **[docs/architecture.md](docs/architecture.md)** — Architecture narrative with Mermaid view and link to the PlantUML deployment diagram.
- **[docs/platform-functionality-inventory.md](docs/platform-functionality-inventory.md)** — Capability inventory mapped to code areas.

Render any `.puml` file with [PlantUML](https://plantuml.com/) (CLI JAR, Docker `plantuml/plantuml`, or IDE extension):

```bash
java -jar plantuml.jar docs/diagrams/architecture/*.puml
java -jar plantuml.jar docs/diagrams/sequence/*.puml
java -jar plantuml.jar docs/diagrams/use-case/*.puml
java -jar plantuml.jar docs/diagrams/class/*.puml
```

---

## License

Private project.
