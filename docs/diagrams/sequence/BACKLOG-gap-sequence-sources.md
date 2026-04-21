# Gap-fill sequence diagrams (sources)

Each `@startuml` … `@enduml` block matches a checked-in file under this folder (e.g. `seq-23-get-auth-me.puml`). Edit the `.puml` file as the source of truth; this file can stay in sync for easy bulk review.

Maps **global use-case** gaps (previously **Partial** / **No**) to diagrams **seq-23** … **seq-41**.

| Use case gap | New file |
|--------------|----------|
| UC_A4 GET `/auth/me` | seq-23 |
| UC_D1 browse library | seq-24 |
| UC_D2 document detail JSON | seq-25 |
| UC_D3 favorites / recents | seq-26 |
| UC_D4 PATCH metadata / tags | seq-27 |
| UC_D5 new version upload | seq-28 |
| UC_D6 reprocess + admin export + bulk delete | seq-29, seq-39, seq-40 |
| UC_S3 list/get/patch/delete conversation | seq-30 |
| UC_S5 admin feedback stats | seq-31 |
| UC_A8 register info page | seq-32 |
| UC_X1 restricted UX | seq-33 |
| UC_P2 POST department (create) | seq-34 |
| UC_P3 POST/DELETE single department access | seq-35 |
| UC_P4 GET stats | seq-36 |
| UC_P4 activity list + export | seq-37 |
| UC_P4 document audit list | seq-38 |

---

## seq-23-get-auth-me.puml

```plantuml
@startuml seq-23-get-auth-me
title GET /auth/me
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /auth" as API <<service>>
participant authenticateToken as AUTH <<service>>
database PostgreSQL as DB
U -> B : open app / refresh user
B -> API : GET /auth/me\nBearer
API -> AUTH : verify JWT, load user + dept sets
alt invalid
  AUTH --> B : 401
else ok
  AUTH -> DB : user.findUnique include role, department
  API -> API : mapUserResponse + manager fields
  API --> B : 200 { user }
end
note right of API : apps/api/src/routes/auth.ts ~517+
@enduml
```

---

## seq-24-documents-list.puml

```plantuml
@startuml seq-24-documents-list
title GET /documents — library list
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
participant "auth + requireDocLibrary" as MW <<service>>
participant listDocuments as L <<service>>
database PostgreSQL as DB
B -> API : GET /documents?…
API -> MW : chain
MW --> API : next
API -> L : listDocuments(filters, user)
L -> DB : scoped query
DB --> L : rows
L --> API : documents, total
API --> B : 200 JSON
note right of API : documents.ts ~425+, documentQuery.ts
@enduml
```

---

## seq-25-document-detail.puml

```plantuml
@startuml seq-25-document-detail
title GET /documents/:documentId
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
participant documentAccess as ACC <<service>>
database PostgreSQL as DB
B -> API : GET /documents/:id\nBearer
API -> DB : findUnique + versions + tags
alt not found
  API --> B : 404
else
  API -> ACC : can read / detail gate
  alt forbidden
    API --> B : 403/404
  else
    API --> B : 200 document payload
  end
end
note right of API : documents.ts ~812+
@enduml
```

---

## seq-26-favorites-recents.puml

```plantuml
@startuml seq-26-favorites-recents
title Favorites + recents
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
database PostgreSQL as DB
== favorite add ==
B -> API : POST /documents/:id/favorite
API -> DB : upsert DocumentUserFavorite + audit FAVORITED
API --> B : 204
== favorite remove ==
B -> API : DELETE /documents/:id/favorite
API -> DB : deleteMany + audit UNFAVORITED
API --> B : 204
== recent ==
B -> API : POST /documents/:id/view
API -> DB : upsert DocumentUserRecent + audit VIEWED
API --> B : 204
note right of API : documents.ts ~644–714
@enduml
```

---

## seq-27-patch-document-metadata.puml

```plantuml
@startuml seq-27-patch-document-metadata
title PATCH /documents/:documentId
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
database PostgreSQL as DB
participant notifyDocumentUpdated as N <<service>>
B -> API : PATCH /documents/:id\nJSON fields
API -> API : requireManage + canManage + Zod
API -> DB : document.update tags/visibility/title…
API -> DB : audit UPDATED
opt dept present
  API -> N : notifyDocumentUpdated.catch
end
API --> B : 200 { document }
note right of API : documents.ts ~517+
@enduml
```

---

## seq-28-document-new-version.puml

```plantuml
@startuml seq-28-document-new-version
title POST /documents/:documentId/versions
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
participant Storage as FS <<service>>
queue BullMQ as Q <<queue>>
database PostgreSQL as DB
B -> API : multipart new file for existing doc
API -> API : requireManage + canManage + multer
API -> FS : save file
API -> DB : transaction create new DocumentVersion\nincrement versionNumber
API -> Q : enqueueDocumentIngest(versionId)
API --> B : 201 version metadata
note right of API : documents.ts ~913+
@enduml
```

---

## seq-29-document-reprocess.puml

```plantuml
@startuml seq-29-document-reprocess
title POST .../versions/:versionId/reprocess
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
queue BullMQ as Q <<queue>>
database PostgreSQL as DB
B -> API : POST .../reprocess
API -> DB : delete chunks; version status PENDING
API -> Q : enqueueDocumentIngest
API -> DB : audit REPROCESS_REQUESTED
API --> B : 200 { ok: true }
note right of API : documents.ts ~876+
@enduml
```

---

## seq-30-conversations-crud-supplement.puml

```plantuml
@startuml seq-30-conversations-crud-supplement
title Conversations — list, get, patch title, delete
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Express /conversations" as API <<service>>
database PostgreSQL as DB
B -> API : GET /conversations/
API -> DB : findMany by userId
API --> B : 200 list
B -> API : GET /conversations/:id
API -> DB : findFirst owned
API --> B : 200 detail
B -> API : PATCH /conversations/:id { title }
API -> DB : update
API --> B : 200
B -> API : DELETE /conversations/:id
API -> DB : delete cascade messages
API --> B : 204/200
note right of API : conversations.ts 25,140,298,386
@enduml
```

---

## seq-31-admin-feedback-stats.puml

```plantuml
@startuml seq-31-admin-feedback-stats
title GET /conversations/feedback/stats (ADMIN)
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /conversations" as API <<service>>
database PostgreSQL as DB
B -> API : GET /conversations/feedback/stats\nBearer
API -> API : authenticate + requireRole(ADMIN)
API -> DB : aggregate AnswerFeedback + weak areas logic
API --> B : 200 stats JSON
note right of API : conversations.ts ~95+
@enduml
```

---

## seq-32-register-info-static.puml

```plantuml
@startuml seq-32-register-info-static
title GET /register (Next.js) — no API
actor Visitor as V <<human>>
participant Browser as B <<browser>>
V -> B : navigate /register
B -> B : render static page\n"no self-registration"
note right of B : apps/web/app/register/page.tsx\nNo backend call.
@enduml
```

---

## seq-33-restricted-page-ux.puml

```plantuml
@startuml seq-33-restricted-page-ux
title /restricted — client-side explanation
actor User as U <<human>>
participant Browser as B <<browser>>
participant "Next /restricted" as P <<browser>>
U -> B : app links to /restricted?feature=…
B -> P : render explanation from query
note right of P : apps/web + restrictions.ts\nAPI 403 path remains **seq-07**
@enduml
```

---

## seq-34-admin-department-create.puml

```plantuml
@startuml seq-34-admin-department-create
title POST /admin/departments
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /admin" as API <<service>>
database PostgreSQL as DB
B -> API : POST /admin/departments { name, parentId? }
API -> API : requireRole ADMIN + Zod
API -> DB : department.create
API --> B : 201 department
note right of API : admin.ts ~250+
@enduml
```

---

## seq-35-dept-access-single-post-delete.puml

```plantuml
@startuml seq-35-dept-access-single-post-delete
title POST + DELETE single UserDepartmentAccess
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /admin" as API <<service>>
database PostgreSQL as DB
B -> API : POST /admin/users/:uid/department-access\n{ departmentId, accessLevel }
API -> DB : upsert + bumpAuth + optional notify
API --> B : 200 row
B -> API : DELETE .../department-access/:deptId
API -> DB : delete + bumpAuth + optional notify
API --> B : 200 ok
note right of API : admin.ts ~2052–2137
@enduml
```

---

## seq-36-admin-stats.puml

```plantuml
@startuml seq-36-admin-stats
title GET /admin/stats
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /admin" as API <<service>>
database PostgreSQL as DB
B -> API : GET /admin/stats
API -> DB : KPI queries / aggregates
API --> B : 200 stats JSON
note right of API : admin.ts ~1311+
@enduml
```

---

## seq-37-admin-activity-export.puml

```plantuml
@startuml seq-37-admin-activity-export
title GET /admin/activity + GET /admin/activity/export
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /admin" as API <<service>>
database PostgreSQL as DB
B -> API : GET /admin/activity?page…
API -> DB : query AuthEvent rows
API --> B : 200 JSON
B -> API : GET /admin/activity/export\n(CSV)
API -> DB : same + CSV escape
API --> B : text/csv stream
note right of API : admin.ts ~1976, ~1938
@enduml
```

---

## seq-38-admin-document-audit.puml

```plantuml
@startuml seq-38-admin-document-audit
title GET /admin/document-audit (+ export)
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /admin" as API <<service>>
database PostgreSQL as DB
B -> API : GET /admin/document-audit?…
API -> DB : query DocumentAuditLog joined
API --> B : 200 JSON
B -> API : GET /admin/document-audit/export
API --> B : CSV
note right of API : admin.ts ~1828, ~1789
@enduml
```

---

## seq-39-admin-documents-csv-export.puml

```plantuml
@startuml seq-39-admin-documents-csv-export
title GET /documents/export (ADMIN CSV)
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
participant listDocuments as L <<service>>
B -> API : GET /documents/export?…\nBearer
API -> API : requireRole(ADMIN)
API -> L : listDocuments wide pageSize
API -> API : build CSV lines + formula escape
API --> B : text/csv attachment
note right of API : documents.ts ~285+
@enduml
```

---

## seq-40-admin-bulk-delete-documents.puml

```plantuml
@startuml seq-40-admin-bulk-delete-documents
title POST /documents/bulk-delete
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /documents" as API <<service>>
database PostgreSQL as DB
participant Storage as FS <<service>>
B -> API : POST /documents/bulk-delete { ids }
API -> API : ADMIN + manage capability
API -> DB : transaction delete docs + audit
API -> FS : delete files per version
API --> B : 200 { deleted: n }
note right of API : documents.ts ~373+
@enduml
```

---

## seq-41-admin-user-patch-lock.puml

```plantuml
@startuml seq-41-admin-user-patch-lock
title PATCH /admin/users/:id + POST lock
actor Admin as A <<human>>
participant Browser as B <<browser>>
participant "Express /admin" as API <<service>>
database PostgreSQL as DB
B -> API : PATCH /admin/users/:id\n(fields…)
API -> DB : validate + user.update\n(may bump authVersion)
API --> B : 200 user
B -> API : POST /admin/users/:id/lock
API -> DB : loginLockedUntil / flags
API --> B : 200
note right of API : admin.ts ~645 patch, ~1160 lock
@enduml
```

Rows for **seq-23 … seq-41** are in [README.md](README.md) in this folder; this file remains for copy-paste blocks and history.
