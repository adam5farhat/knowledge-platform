# Global class diagram — Knowledge Platform

This document explains the **persisted domain model** shown in [global-class-diagram.puml](global-class-diagram.puml). The diagram is generated from the Prisma schema: [apps/api/prisma/schema.prisma](../../../apps/api/prisma/schema.prisma).

---

## How to render

Use any [PlantUML](https://plantuml.com/) distribution (IDE extension, CLI JAR, or Docker image) on `docs/diagrams/class/global-class-diagram.puml`. The diagram is intentionally dense; zoom or export to SVG for documentation.

---

## Package overview

### IdentityAndAccess

- **`Role`** — Lookup row for global platform role; `name` uses enum **`RoleName`** (`ADMIN`, `MANAGER`, `EMPLOYEE`). Users reference exactly one role (`roleId`, `onDelete: Restrict`).
- **`Department`** — Organizational unit with an optional **`parentDepartmentId`** self-reference (tree). Users have a **primary** `departmentId` (required).
- **`User`** — Accounts with credentials, profile fields, **feature restriction** booleans (`accessDocumentsAllowed`, `manageDocumentsAllowed`, `useAiQueriesAllowed`, etc.), lockout and `authVersion` for token invalidation, and soft-delete via `deletedAt`.
- **`UserDepartmentAccess`** — Additional departments per user with **`DepartmentAccessLevel`** (`MEMBER`, `MANAGER`, `VIEWER`). Unique pair `(userId, departmentId)`. Application logic combines this with the tree for readable/manageable department sets (see `departmentAccess.ts` in the API, not on the diagram).

### Authentication

- **`PasswordResetToken`** — Short-lived hashed reset tokens tied to a user (`onDelete: Cascade`).
- **`RefreshSession`** — Rotating refresh tokens (hashed), session metadata, revocation and replacement for replay-safe rotation (`onDelete: Cascade` from user).
- **`AuthEvent`** — Append-only security/audit log (`AuthEventType` enum); `userId` optional so failed logins without a resolved user can still be stored (`onDelete: SetNull`).

### DocumentLibrary

- **`Document`** — Logical document: title, description, **`DocumentVisibility`** (`ALL`, `DEPARTMENT`, `PRIVATE`), optional `departmentId`, archive flag, creator `createdById`.
- **`DocumentVersion`** — Immutable file snapshot per version: storage key, hash, MIME, **`DocumentProcessingStatus`** for the ingest pipeline. Unique `(documentId, versionNumber)`.
- **`DocumentChunk`** — Text segment for retrieval: `content`, optional `sectionTitle`, **`embedding`** (pgvector 768-d) and optional **`searchVector`** (PostgreSQL `tsvector`). Prisma models these as `Unsupported(...)`; the class diagram labels the SQL types and references a note.
- **`DocumentTag`** — Normalized tag names; **implicit many-to-many** with `Document` (no explicit join table in Prisma).
- **`DocumentUserFavorite`** / **`DocumentUserRecent`** — Associative tables with composite primary key `(userId, documentId)` for library UX.
- **`DocumentAuditLog`** — Events with **`DocumentAuditAction`** enum; optional links to document and user when rows survive deletion (`onDelete: SetNull`).

### AiConversations

- **`Conversation`** — Per-user thread for Ask UI; title and timestamps.
- **`ConversationMessage`** — Messages with `role` (e.g. user/assistant) stored as string, optional `sources` JSON and `confidence` for assistant rows.
- **`AnswerFeedback`** — At most one feedback row per message (`messageId` unique); rating stored as string (`"up"` / `"down"`) per schema comment.

### Notifications

- **`Notification`** — Logical notification: type, title/body, optional actor/document/department FKs, manual-send targeting fields (`NotificationTarget`, optional role/department ids), optional attachment metadata.
- **`UserNotification`** — Per-recipient inbox row: read state, unique `(userId, notificationId)`; cascade when notification or user is removed.

---

## Relation legend (on diagram)

Multiplicities follow UML-style reading of associations. Stereotypes **`«Cascade»`**, **`«Restrict»`**, and **`«SetNull»`** on links match Prisma **`onDelete`** behavior for foreign keys.

---

## Cross-cutting data flows (conceptual)

1. **Sign-in / refresh** — `RefreshSession` + `AuthEvent`; invalidation via `User.authVersion` vs session row.
2. **Upload / RAG** — `Document` → new `DocumentVersion` → worker produces `DocumentChunk` rows with vector + FTS columns.
3. **Ask** — Reads allowed chunks by access rules in code; persists `Conversation` / `ConversationMessage` / optional `AnswerFeedback`.
4. **Announcements** — `Notification` created once; many `UserNotification` rows for recipients (fan-out).

---

## Related UML artifacts

- Global use cases: [global-use-case.md](../use-case/global-use-case.md) and [global-use-case-diagram.puml](../use-case/global-use-case-diagram.puml).
