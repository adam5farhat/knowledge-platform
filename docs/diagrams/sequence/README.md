# UML sequence diagrams (professional pack)

PlantUML **sequence** diagrams for end-to-end flows in the Knowledge Platform. Each file is self-contained; verify against the source files cited in the diagram notes before treating diagrams as authoritative for audits.

## Index

| File | Flow |
|------|------|
| [seq-01-login.puml](seq-01-login.puml) | `POST /auth/login` — validation, user lookup, bcrypt, lockout, `issueSessionTokens`, HttpOnly `kp_rt`, JSON access token |
| [seq-02-refresh-token.puml](seq-02-refresh-token.puml) | `POST /auth/refresh` — cookie, session rotation, replay/family revocation, `authVersion` |
| [seq-03-logout.puml](seq-03-logout.puml) | `POST /auth/logout` — revoke refresh session, clear cookie |
| [seq-04-password-reset.puml](seq-04-password-reset.puml) | `POST /auth/forgot-password` + `POST /auth/reset-password` |
| [seq-05-change-password.puml](seq-05-change-password.puml) | `POST /auth/change-password` — revoke sessions, new tokens |
| [seq-06-profile-update.puml](seq-06-profile-update.puml) | `PATCH /auth/profile` — validation, optional email change + token rotation |
| [seq-07-feature-restriction.puml](seq-07-feature-restriction.puml) | `requireDocLibraryAccess` / `requireUseAiQueries` → 403 `FEATURE_RESTRICTED` |
| [seq-08-document-upload.puml](seq-08-document-upload.puml) | `POST /documents/upload` — storage, Prisma tx, `enqueueDocumentIngest`, optional `notifyDocumentCreated` |
| [seq-09-document-ingest-worker.puml](seq-09-document-ingest-worker.puml) | BullMQ worker `processIngest` — extract, chunk, embed, persist chunks |
| [seq-10-document-read-download.puml](seq-10-document-read-download.puml) | `GET /documents/:id/versions/:versionId/file` — `canReadDocument`, stream file |
| [seq-11-semantic-search.puml](seq-11-semantic-search.puml) | `POST /search/semantic` — embed query, `vectorSearch` |
| [seq-12-ask-rag-sse.puml](seq-12-ask-rag-sse.puml) | `POST /search/ask` — optimize, hybrid retrieval, rerank, SSE, optional critique |
| [seq-13-conversation-and-messages.puml](seq-13-conversation-and-messages.puml) | Conversation CRUD / messages (representative) |
| [seq-14-answer-feedback.puml](seq-14-answer-feedback.puml) | `POST /conversations/:id/messages/:messageId/feedback` |
| [seq-15-notification-automatic.puml](seq-15-notification-automatic.puml) | `notifyDocumentCreated` → `createNotification` + recipient fan-out |
| [seq-16-notification-manual-send.puml](seq-16-notification-manual-send.puml) | `POST /notifications/send` — multipart, targets, fan-out |
| [seq-17-notification-inbox.puml](seq-17-notification-inbox.puml) | Inbox list, unread count, mark read, attachment download |
| [seq-18-manager-dashboard.puml](seq-18-manager-dashboard.puml) | `GET /manager/departments`, `GET /manager/department` |
| [seq-19-admin-user-create.puml](seq-19-admin-user-create.puml) | `POST /admin/users` |
| [seq-20-admin-department-merge.puml](seq-20-admin-department-merge.puml) | `POST /admin/departments/merge` |
| [seq-21-admin-department-access-bulk.puml](seq-21-admin-department-access-bulk.puml) | `PUT /admin/users/:userId/department-access` |
| [seq-22-health-check.puml](seq-22-health-check.puml) | `GET /health` |
| [seq-23-get-auth-me.puml](seq-23-get-auth-me.puml) | `GET /auth/me` — JWT verify, user + departments in session payload |
| [seq-24-documents-list.puml](seq-24-documents-list.puml) | `GET /documents` — auth, doc-library gate, `listDocuments`, scoped list + total |
| [seq-25-document-detail.puml](seq-25-document-detail.puml) | `GET /documents/:id` — detail JSON, access check |
| [seq-26-favorites-recents.puml](seq-26-favorites-recents.puml) | Favorite POST/DELETE + recent view POST — audit side effects |
| [seq-27-patch-document-metadata.puml](seq-27-patch-document-metadata.puml) | `PATCH /documents/:id` — manage permission, metadata/tags, optional notify |
| [seq-28-document-new-version.puml](seq-28-document-new-version.puml) | `POST /documents/:id/versions` — new file, version row, ingest enqueue |
| [seq-29-document-reprocess.puml](seq-29-document-reprocess.puml) | `POST .../versions/:versionId/reprocess` — reset chunks, re-enqueue ingest |
| [seq-30-conversations-crud-supplement.puml](seq-30-conversations-crud-supplement.puml) | Conversations list, get, patch title, delete (supplement to seq-13) |
| [seq-31-admin-feedback-stats.puml](seq-31-admin-feedback-stats.puml) | `GET /conversations/feedback/stats` — admin aggregates |
| [seq-32-register-info-static.puml](seq-32-register-info-static.puml) | Next.js `/register` — static “no self-registration” page |
| [seq-33-restricted-page-ux.puml](seq-33-restricted-page-ux.puml) | `/restricted` — client explanation; API 403 remains seq-07 |
| [seq-34-admin-department-create.puml](seq-34-admin-department-create.puml) | `POST /admin/departments` — create department |
| [seq-35-dept-access-single-post-delete.puml](seq-35-dept-access-single-post-delete.puml) | POST/DELETE single `UserDepartmentAccess` for a user |
| [seq-36-admin-stats.puml](seq-36-admin-stats.puml) | `GET /admin/stats` — KPI-style aggregates |
| [seq-37-admin-activity-export.puml](seq-37-admin-activity-export.puml) | `GET /admin/activity` + CSV export stream |
| [seq-38-admin-document-audit.puml](seq-38-admin-document-audit.puml) | `GET /admin/document-audit` + export |
| [seq-39-admin-documents-csv-export.puml](seq-39-admin-documents-csv-export.puml) | `GET /documents/export` — admin CSV of document list |
| [seq-40-admin-bulk-delete-documents.puml](seq-40-admin-bulk-delete-documents.puml) | `POST /documents/bulk-delete` — admin transactional delete + storage |
| [seq-41-admin-user-patch-lock.puml](seq-41-admin-user-patch-lock.puml) | `PATCH /admin/users/:id` + `POST .../lock` |

### Gap-fill (use-case Partial / No coverage)

Diagrams **seq-23 … seq-41** are checked in as `.puml` files above. [BACKLOG-gap-sequence-sources.md](BACKLOG-gap-sequence-sources.md) retains the same PlantUML blocks for copy-paste or diff history.

## Rendering

Use [PlantUML](https://plantuml.com/sequence-diagram) (CLI JAR, Docker `plantuml/plantuml`, or IDE extension) on each `.puml` file. From repo root example:

```bash
java -jar plantuml.jar docs/diagrams/sequence/*.puml
```

## Maintenance

**Last verified against commit:** (fill when you re-validate diagrams after major refactors).

Parent docs: [../use-case/global-use-case.md](../use-case/global-use-case.md), [../class/global-class.md](../class/global-class.md), [../../platform-functionality-inventory.md](../../platform-functionality-inventory.md), [../../architecture.md](../../architecture.md).
