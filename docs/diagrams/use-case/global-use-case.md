# Global use-case diagram — Knowledge Platform

This document implements the global UML use-case inventory for the repository. Machine-readable diagram source: [global-use-case-diagram.puml](global-use-case-diagram.puml) (PlantUML).

**Related:** [Platform architecture](../../architecture.md) · [Class model](../class/global-class.md) · [Sequence diagrams](../sequence/README.md)

**Related code:** [README.md](../../../README.md), [apps/api/src/httpApp.ts](../../../apps/api/src/httpApp.ts), [apps/api/prisma/schema.prisma](../../../apps/api/prisma/schema.prisma).

---

## 1. Primary actors

| Actor | Description | Implementation notes |
|--------|-------------|----------------------|
| **Guest** | Unauthenticated visitor | Public routes only; no bearer token. |
| **Employee** | User with platform role `EMPLOYEE` | `RoleName.EMPLOYEE` in Prisma; standard library and AI access when restrictions allow. |
| **Manager** | User with platform role `MANAGER` | `RoleName.MANAGER`; manager dashboard; may send manual notifications (department targets they manage). |
| **Administrator** | User with platform role `ADMIN` | `RoleName.ADMIN`; full `/admin/*` surface; broader document visibility in search SQL; all departments on manager APIs. |

### Department-scoped management (cross-cutting)

Users may have **`UserDepartmentAccess`** with `DepartmentAccessLevel.MANAGER` (or inherited manage scope via `departmentAccess.ts`) while their **platform role** remains `EMPLOYEE`.

- **Manager dashboard** (`/manager/*`, `requireManagerDashboardAccess`): allowed for **Administrator**, **platform Manager**, or anyone with **≥1** manageable department id (includes Employees with department-level manager access). See [apps/api/src/middleware/auth.ts](../../../apps/api/src/middleware/auth.ts).
- **Send manual notification** (`POST /notifications/send`): **`requireRole(ADMIN, MANAGER)` only** — Employees with department manager access **do not** get this endpoint. See [apps/api/src/routes/notifications.ts](../../../apps/api/src/routes/notifications.ts).

**Diagram options:** annotate manager-dashboard use cases with `{manageableDepartmentIds ≥ 1}` for Employees, or add a note on the diagram as in the `.puml` file.

---

## 2. Secondary actors

| Actor | Interaction |
|--------|-------------|
| **Email (SMTP) service** | Sends password-reset messages ([apps/api/src/lib/email.ts](../../../apps/api/src/lib/email.ts)). |
| **AI provider (Google Gemini)** | Embeddings, retrieval, reranking, streamed answers ([apps/api/src/routes/search.ts](../../../apps/api/src/routes/search.ts), conversations). |
| **Document processing subsystem** | BullMQ worker ingests uploaded files ([apps/api/src/jobs/documentIngest.ts](../../../apps/api/src/jobs/documentIngest.ts)); optional on diagrams as «System». |

---

## 3. Actor generalization (UML)

- **Code reality:** `RoleName` is an **enum**, not an inheritance hierarchy between people.
- **Diagram choice (used in `.puml`):** Abstract actor **`Authenticated user`** with **generalization** from **Administrator**, **Manager**, and **Employee** to reduce duplicate associations for shared authenticated use cases.
- **Not modeled:** Privilege inheritance such as “Manager is a kind of Admin” — the API uses explicit `requireRole(...)` sets and separate helpers (`isPlatformAdmin`, `requireManagerDashboardAccess`, restriction flags).

**Guest** is **not** specialized from `Authenticated user` (mutually exclusive session states).

---

## 4. Global use cases (verb–noun)

Legend: **A** = Administrator only · **M** = platform Manager · **E** = Employee · **G** = Guest · **Auth** = any authenticated user · **R(x)** = precondition: user restriction / middleware (`accessDocumentsAllowed`, `useAiQueriesAllowed`, `accessDashboardAllowed`, `loginAllowed`, etc.) · **DM** = department-level manage access (may apply without platform Manager role)

### Authentication and account

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-A1 | Sign in | G | Rate-limited; issues access token + refresh cookie. |
| UC-A2 | Refresh session | Auth | HttpOnly refresh cookie. |
| UC-A3 | Sign out | Auth | Revokes refresh session. |
| UC-A4 | View current user profile | Auth | `/auth/me` pattern. |
| UC-A5 | Update profile | Auth | Patch profile fields / avatar rules. |
| UC-A6 | Change password | Auth | Rate-limited; may bump `authVersion`. |
| UC-A7 | Request password reset | G | Forgot-password flow; anti-enumeration timing. |
| UC-A8 | Complete password reset | G | Token from email link. |
| UC-A9 | Read account provisioning information | G | `/register` is **informational only** — no self-registration API. |

### Document library

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-D1 | Browse document library | Auth | **R(`accessDocumentsAllowed`)**. |
| UC-D2 | View document detail | Auth | Scoped by `documentAccess.ts` / visibility. |
| UC-D3 | Download document | Auth | Same read rules. |
| UC-D4 | Run library search / filters | Auth | **R(`accessDocumentsAllowed`)**. |
| UC-D5 | Upload or replace document content | A, M | **`requireManageDocumentsCapability`**: platform role **not** `EMPLOYEE`; **R(`manageDocumentsAllowed`)**. Employees cannot pass this middleware. |
| UC-D6 | Manage document metadata | Auth | Create/update where API allows; visibility `ALL` / `DEPARTMENT` / `PRIVATE`. |
| UC-D7 | Manage favorites and recents | Auth | **R(`accessDocumentsAllowed`)** where routes apply. |
| UC-D8 | Manage tags | Auth | Per documents routes. |
| UC-D9 | Perform admin-only document maintenance | A | `requireRole(ADMIN)` endpoints in documents router. |

### Search and AI

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-S1 | Run semantic search | Auth | **R(`useAiQueriesAllowed`)**; admin sees broader chunk set in SQL filter. |
| UC-S2 | Ask question (RAG, SSE) | Auth | **R(`useAiQueriesAllowed`)**; rate limited. |
| UC-S3 | Manage AI conversations | Auth | List/create/update threads; messages. |
| UC-S4 | Submit answer feedback | Auth | Thumbs / comments. |
| UC-S5 | View aggregate AI feedback analytics | A | `/conversations/feedback/stats`. |

### Notifications

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-N1 | List notifications | Auth | Paginated inbox. |
| UC-N2 | View unread notification count | Auth | Polling / badge. |
| UC-N3 | Mark notification read | Auth | Single or mark-all. |
| UC-N4 | Delete user notification | Auth | |
| UC-N5 | Download notification attachment | Auth | Authenticated streaming download. |
| UC-N6 | Send manual notification | A, M | **Not** DM-only Employees. Managers: department target only, managed departments. |

### Manager dashboard

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-G1 | List manageable departments | A, M, E | **R(`accessDashboardAllowed`)** + `requireManagerDashboardAccess` (Admin, platform Manager, or **DM** on Employee). |
| UC-G2 | View department profile and members | A, M, E | Same gate + department permission check. |

### Administration

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-P1 | Manage users (CRUD, lock, sessions, import) | A | `/admin/users*`. |
| UC-P2 | Manage departments (CRUD, merge) | A | |
| UC-P3 | Manage user department access | A | `UserDepartmentAccess` bulk/upsert. |
| UC-P4 | View KPIs, stats, activity, document audit | A | Includes exports. |
| UC-P5 | Configure or inspect system settings | A | Admin system routes as implemented. |

### Cross-cutting

| ID | Use case | Actors | Notes |
|----|----------|--------|-------|
| UC-X1 | View restricted-feature explanation | Auth | When a restriction flag blocks a feature ([apps/web/lib/restrictions.ts](../../../apps/web/lib/restrictions.ts)); e.g. `/restricted`. |

---

## 5. Verification checklist

1. **No self-registration** as a system use case (only UC-A9 informational).
2. **UC-N6** only **Administrator** and **platform Manager**, not DM-only Employees.
3. **Restrictions** documented as **R(...)** preconditions on relevant use cases.
4. **Admin** broader read scope for search/ask is a **scope** detail on UC-S1/UC-S2, not a separate actor.

---

## 6. Future detailed diagrams

Suggested refinements (not in the global `.puml`):

- **Document library** — upload/version/visibility state machine.
- **Administration** — user lifecycle vs. department access.
- **Search & Ask** — SSE events and secondary actor **AI provider**.

Render [global-use-case-diagram.puml](global-use-case-diagram.puml) with [PlantUML](https://plantuml.com/) or the PlantUML extension in your IDE.
