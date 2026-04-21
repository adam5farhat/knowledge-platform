# Platform functionality inventory

Consolidated checklist of **Knowledge Platform** capabilities, grouped into **user-facing**, **AI / RAG pipeline**, and **system / platform** areas.

**Primary sources:** [README.md](../README.md) (features, architecture), [apps/api/src/httpApp.ts](../apps/api/src/httpApp.ts) (route mounts), [apps/api/prisma/schema.prisma](../apps/api/prisma/schema.prisma) (persisted domain).

**Route tables (README):** [API reference (routes)](../README.md#api-reference-routes) · [Web application (routes)](../README.md#web-application-routes).

---

## 1. User-facing (authenticated and guest)

### Authentication and account

- Sign in, sign out, token refresh (single-flight on web), session cap (10), refresh cookie handling and family revocation on replay.
- Password policy (complexity, length), change password (same-password blocked, `authVersion` bump), forgot / reset password, optional SMTP or dev log.
- Profile view/update (name, email, phone, position, badge, avatar URL rules), avatar upload (admin path for others per README admin section).
- Account restriction flags: login, document library, manage documents, dashboard, AI queries.
- Public informational “register” page (no self-service registration); home routing by role and restrictions.
- Rate limits on login, refresh, forgot/reset, change-password paths.

**See also:** [README — Authentication and session](../README.md#authentication-and-session), [API reference — `/auth/*`](../README.md#api-reference-routes), [Web routes — login, register, forgot-password, reset-password](../README.md#web-application-routes).

### Document library

- List/browse documents with access-aware filtering; document detail; download; upload and new versions; processing status visibility.
- Visibility: org-wide, department-scoped, private; archive; delete (permission-checked).
- Tags, favorites, recents; audit log of user-visible actions; inline PDF/image preview (web).

**See also:** [README — Document library](../README.md#document-library), [API — `/documents/*`](../README.md#api-reference-routes), [Web — `/documents`](../README.md#web-application-routes).

### Search (non-RAG and UI)

- Library search UX; semantic search endpoint consumption where exposed in UI.

**See also:** [README — Search and AI](../README.md#search-and-ai), `/search/semantic` in [API reference](../README.md#api-reference-routes).

### Ask (RAG UI)

- Chat-style Ask UI with streaming markdown, sources panel, link sanitization; conversation history in UI; restricted when `useAiQueriesAllowed` is off.

**See also:** [README — Search and AI, SSE events](../README.md#search-post-searchask-sse), [Web — `/documents/ask`](../README.md#web-application-routes).

### Conversations

- List/create/update/delete conversations; append messages; generate conversation title; thumbs up/down and optional comment on assistant messages.

**See also:** [README — Conversations](../README.md#conversations), [API — `/conversations/*`](../README.md#api-reference-routes).

### Notifications

- Inbox list (pagination), unread count (polling + visibility), mark one read, mark all read, delete from list, download attachment; send manual announcement (admin / platform manager only) with targets and optional attachment.

**See also:** [README — Notification system](../README.md#notification-system), [API — Notifications table](../README.md#notifications).

### Manager dashboard

- List manageable departments; department detail with member list (scoped to manage permissions).

**See also:** [README — Manager](../README.md#manager), [API — `/manager/*`](../README.md#api-reference-routes), [Web — `/manager`](../README.md#web-application-routes).

### Administration (admin role)

- Users: CRUD, soft delete/restore, lock/unlock, set password, revoke sessions, bulk restrictions, CSV import, avatars; last-admin safety.
- Departments: CRUD, hierarchy, merge, delete with checks; per-user department access CRUD and department-centric access listing.
- Stats, KPI time series; activity log and document audit views; CSV exports (formula-injection escaping).
- Admin documents / activity / system modules as in web routes.

**See also:** [README — Admin](../README.md#admin), [API — `/admin/*`](../README.md#api-reference-routes), [Admin department access paths](../README.md#admin-department-access-multi-department), [Web — `/admin/*`](../README.md#web-application-routes).

### Cross-UX

- Dashboard adaptive cards; manager/admin chrome; toasts, confirm dialogs, spinner, error boundaries; theming (light/dark/system); animations with reduced-motion; client-side `Link` navigation; `/restricted` explanations.

**See also:** [README — Web UX](../README.md#web-ux), [Web — `/restricted`](../README.md#web-application-routes).

---

## 2. AI and RAG pipeline (product + technical)

### Retrieval and answering

- Query optimization / rewriting (`queryOptimizer.ts`).
- Parallel **vector** (pgvector) and **BM25 / full-text** search over `DocumentChunk` with access filters.
- **RRF** fusion of rankings; optional multi-hop retrieval; **Gemini reranking** of chunks.
- **Confidence** assessment from scores; streaming **SSE** answer on `/search/ask` (`sources`, `token`, optional `correction`, `done`).
- Optional **critique/correct** post-pass (`ragEvaluation.ts`) emitting `correction` event.
- Semantic search endpoint `/search/semantic` (vector retrieval path).
- Rate limit on `/search/ask`; TTL cache and retry/backoff for Gemini rate limits (`cache.ts`).

**See also:** [README — Final version capabilities](../README.md#final-version-capabilities-delivered), [README — AI / RAG pipeline](../README.md#ai--rag-pipeline), [Backend module reference](../README.md#backend-module-reference-appsapisrclib), [Search: POST /search/ask (SSE)](../README.md#search-post-searchask-sse).

### Ingest and embeddings

- On upload/version: enqueue **BullMQ** job; worker **extract** text (`extractText.ts`), **chunk** (`chunkText.ts`), **embed** (768-d Gemini), persist `DocumentChunk` with vector + optional `tsvector`; update version/document processing status (`PENDING` / `PROCESSING` / `READY` / `FAILED`).
- Failed job retention policy (README: TTL and cap).

**See also:** [README — Document ingest worker](../README.md#document-ingest-worker), [README — High-level architecture](../README.md#high-level-architecture).

### Memory and feedback

- Persist conversations and messages (sources JSON, confidence on assistant turns).
- **AnswerFeedback** storage; admin **feedback stats** endpoint; **feedback memory** (negative patterns) injected into ask prompts (`feedbackMemory.ts`).

**See also:** [README — Conversations, feedback memory](../README.md#conversations), Prisma models `Conversation`, `ConversationMessage`, `AnswerFeedback` in [schema.prisma](../apps/api/prisma/schema.prisma).

### External AI

- Google Gemini: embeddings, query optimization, rerank, chat/streaming generation (per README stack table).

**See also:** [README — Technology stack (AI)](../README.md#technology-stack), [Environment variables — GEMINI](../README.md#environment-variables).

---

## 3. System, security, and operations

### API and HTTP

- Express app: JSON body, CORS, Helmet CSP, compression, request IDs, global error handler (`AppError`), 404 JSON.
- Route mounts: `/auth`, `/admin`, `/manager`, `/documents`, `/search`, `/conversations`, `/notifications`, `/avatars` (public).
- Service probe `GET /`; **health** `GET /health` (Postgres + Redis).

**See also:** [apps/api/src/httpApp.ts](../apps/api/src/httpApp.ts), [README — API reference](../README.md#api-reference-routes).

### Data and persistence

- PostgreSQL + Prisma ORM; migrations; seed roles/admin; pgvector and FTS columns on chunks.

**See also:** [README — Data model](../README.md#data-model-overview), [docs/diagrams/class/global-class.md](diagrams/class/global-class.md).

### Caching and queues

- Redis client; BullMQ connection for ingest worker (same API process per README).

**See also:** [README — High-level architecture](../README.md#high-level-architecture), [README — Document ingest worker](../README.md#document-ingest-worker).

### Files and storage

- Configurable storage path; multer uploads; MIME allowlists (documents, avatars, notification attachments); streaming downloads; path safety.

**See also:** [README — Technology stack (Files)](../README.md#technology-stack), [Backend module reference — storage](../README.md#backend-module-reference-appsapisrclib).

### Security controls

- JWT access (HS256, short TTL); refresh in HttpOnly cookie; `authVersion` invalidation; bcrypt password hashing; timing-attack mitigations; IP extraction; CSV export escaping; profile picture URL restrictions; markdown/link policies on Ask UI; CSP on API and Next headers.

**See also:** [README — Security, access control, and departments](../README.md#security-access-control-and-departments), [README — Transport and headers](../README.md#transport-and-headers).

### Email

- Nodemailer with TLS for password reset (optional SMTP).

**See also:** [README — Authentication (password reset)](../README.md#authentication-and-session), [Backend module reference — email](../README.md#backend-module-reference-appsapisrclib).

### Auth audit

- `AuthEvent` logging for login/refresh/logout/password events.

**See also:** Prisma model `AuthEvent` in [schema.prisma](../apps/api/prisma/schema.prisma).

### DevOps

- Dockerfiles for API and web; docker-compose (Postgres, Redis, services); GitHub Actions CI (lint, typecheck, test); structured logging in production.

**See also:** [README — Repository layout](../README.md#repository-layout), [README — Testing](../README.md#testing), [README — Production deployment notes](../README.md#production-deployment-notes).

### Document audit (system record)

- Server-side audit log writes for document lifecycle (admin visibility and export).

**See also:** [README — Admin (document audit)](../README.md#admin), Prisma model `DocumentAuditLog` in [schema.prisma](../apps/api/prisma/schema.prisma).

---

## Related UML docs

- [docs/diagrams/use-case/global-use-case.md](diagrams/use-case/global-use-case.md)
- [docs/diagrams/class/global-class.md](diagrams/class/global-class.md)
- [docs/diagrams/sequence/README.md](diagrams/sequence/README.md) (sequence diagrams)
- [docs/architecture.md](architecture.md) (platform architecture narrative + diagram)
