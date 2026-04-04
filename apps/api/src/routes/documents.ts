import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Router } from "express";
import multer from "multer";
import type { Prisma } from "@prisma/client";
import { DocumentAuditAction, DocumentVisibility, RoleName } from "@prisma/client";
import { z } from "zod";
import { authenticateToken, requireRole } from "../middleware/auth.js";
import { requireDocLibraryAccess, requireManageDocumentsCapability } from "../middleware/restrictions.js";
import { logDocumentAudit } from "../lib/documentAudit.js";
import { canManageDocument, canReadDocument } from "../lib/documentAccess.js";
import { docListInclude, listDocuments, mapDocumentRow, parseLibraryScope } from "../lib/documentQuery.js";
import { prisma } from "../lib/prisma.js";
import {
  allocateStorageKey,
  absolutePathForKey,
  deleteFileIfExists,
  saveUploadedFile,
} from "../lib/storage.js";
import { resolveMimeType, SUPPORTED_EXTRACTION_MIMES } from "../lib/extractText.js";
import { enqueueDocumentIngest } from "../jobs/documentIngest.js";
import { normalizeTagName, parseTagListInput } from "../lib/tags.js";

export const documentsRouter = Router();

/** Admin departments drill: "General" dept card + org-wide docs (`departmentId` null). */
const DEPT_FILTER_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function unionGeneralDepartmentIdForQuery(
  user: { role: RoleName },
  query: Record<string, unknown>,
  departmentKey: string | undefined,
): string | undefined {
  if (user.role !== RoleName.ADMIN) return undefined;
  const on = query.unionGeneralLibrary === "1" || query.unionGeneralLibrary === "true";
  if (!on || !departmentKey || departmentKey === "__general") return undefined;
  if (!DEPT_FILTER_UUID_RE.test(departmentKey)) return undefined;
  return departmentKey;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const resolved = resolveMimeType(file.originalname, file.mimetype);
    if (!SUPPORTED_EXTRACTION_MIMES.has(resolved)) {
      cb(new Error(`Unsupported file type (${file.mimetype}). Upload a supported document format.`));
      return;
    }
    cb(null, true);
  },
});

const uploadMeta = z.object({
  title: z.string().min(1).max(500),
  visibility: z.nativeEnum(DocumentVisibility).optional(),
  departmentId: z.string().uuid().optional().nullable(),
  description: z.string().max(20000).optional().nullable(),
});

documentsRouter.post(
  "/upload",
  authenticateToken,
  requireDocLibraryAccess,
  requireManageDocumentsCapability,
  requireRole(RoleName.ADMIN, RoleName.MANAGER),
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const parsed = uploadMeta.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing file field (multipart name: file)" });
      return;
    }

    let visibility = parsed.data.visibility ?? DocumentVisibility.ALL;
    let departmentId: string | null = parsed.data.departmentId ?? null;

    if (visibility === DocumentVisibility.DEPARTMENT && !departmentId) {
      departmentId = user.departmentId;
    }

    if (visibility === DocumentVisibility.DEPARTMENT && departmentId) {
      const dept = await prisma.department.findUnique({
        where: { id: departmentId },
      });
      if (!dept) {
        res.status(400).json({ error: "Invalid department" });
        return;
      }
    }

    if (user.role !== "ADMIN" && departmentId && departmentId !== user.departmentId) {
      res.status(403).json({ error: "You can only assign documents to your own department" });
      return;
    }

    const mimeType = resolveMimeType(file.originalname, file.mimetype);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const storageKey = allocateStorageKey(user.departmentId, file.originalname);

    await saveUploadedFile(storageKey, file.buffer);

    const tagNames = parseTagListInput(req.body.tags);

    try {
      const { doc, version } = await prisma.$transaction(async (tx) => {
        const doc = await tx.document.create({
          data: {
            title: parsed.data.title.trim(),
            description: parsed.data.description?.trim() || null,
            createdById: user.id,
            departmentId: visibility === DocumentVisibility.DEPARTMENT ? departmentId : null,
            visibility,
            ...(tagNames.length > 0
              ? {
                  tags: {
                    connectOrCreate: tagNames.map((name) => ({
                      where: { name },
                      create: { name },
                    })),
                  },
                }
              : {}),
          },
        });

        const version = await tx.documentVersion.create({
          data: {
            documentId: doc.id,
            versionNumber: 1,
            fileName: file.originalname,
            mimeType,
            storageKey,
            sizeBytes: file.size,
            sha256,
            createdById: user.id,
          },
        });

        return { doc, version };
      });

      await enqueueDocumentIngest(version.id);

      await logDocumentAudit(prisma, {
        documentId: doc.id,
        userId: user.id,
        action: DocumentAuditAction.CREATED,
        metadata: { title: doc.title },
      });

      res.status(201).json({
        document: {
          id: doc.id,
          title: doc.title,
          visibility: doc.visibility,
          departmentId: doc.departmentId,
          createdAt: doc.createdAt,
          tags: tagNames,
        },
        version: {
          id: version.id,
          versionNumber: version.versionNumber,
          processingStatus: version.processingStatus,
          processingProgress: version.processingProgress,
          fileName: version.fileName,
        },
      });
    } catch (e) {
      await deleteFileIfExists(storageKey);
      throw e;
    }
  },
);

documentsRouter.use(authenticateToken, requireDocLibraryAccess);

documentsRouter.get("/tags/suggestions", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const qRaw = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const visibleDocs: Prisma.DocumentWhereInput =
    user.role === "ADMIN"
      ? { isArchived: false }
      : {
          AND: [
            {
              OR: [
                { visibility: DocumentVisibility.ALL },
                {
                  visibility: DocumentVisibility.DEPARTMENT,
                  departmentId: user.departmentId,
                },
                {
                  visibility: DocumentVisibility.PRIVATE,
                  createdById: user.id,
                },
              ],
            },
            { isArchived: false },
          ],
        };

  const tags = await prisma.documentTag.findMany({
    where: {
      ...(qRaw.length > 0 ? { name: { contains: qRaw.toLowerCase(), mode: "insensitive" } } : {}),
      documents: { some: visibleDocs },
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 24,
  });

  res.json({ tags: tags.map((t) => t.name) });
});

function parsePageParams(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(query.pageSize ?? "50"), 10) || 50));
  return { page, pageSize };
}

async function attachFavoriteFlags(
  userId: string,
  docs: Prisma.DocumentGetPayload<{ include: typeof docListInclude }>[],
): Promise<{ isFavorited: boolean }[]> {
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const favs = await prisma.documentUserFavorite.findMany({
    where: { userId, documentId: { in: ids } },
    select: { documentId: true },
  });
  const favSet = new Set(favs.map((f) => f.documentId));
  return docs.map((d) => ({
    isFavorited: favSet.has(d.id),
  }));
}

documentsRouter.get(
  "/export",
  requireRole(RoleName.ADMIN),
  async (req, res) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const tagRaw = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
    const visibilityRaw = typeof req.query.visibility === "string" ? req.query.visibility : "ALL";
    const statusRaw = typeof req.query.status === "string" ? req.query.status : "ALL";
    const libraryScope = parseLibraryScope(req.query.libraryScope);
    const departmentKey =
      typeof req.query.departmentId === "string" ? req.query.departmentId.trim() : undefined;
    const unionGeneralWithDepartmentId = unionGeneralDepartmentIdForQuery(
      user,
      req.query as Record<string, unknown>,
      departmentKey,
    );
    const fileType = typeof req.query.fileType === "string" ? req.query.fileType : "ALL";
    const dateFilter = typeof req.query.dateFilter === "string" ? req.query.dateFilter : "ALL";
    const allScopeIncludeArchived =
      req.query.includeArchived === "1" || req.query.includeArchived === "true";

    const needsAttention =
      user.role === RoleName.ADMIN &&
      (req.query.needsAttention === "1" || req.query.needsAttention === "true");

    let createdById: string | undefined;
    if (user.role === RoleName.ADMIN && typeof req.query.createdById === "string") {
      const c = req.query.createdById.trim();
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c)) {
        createdById = c;
      }
    }

    const { documents: docs } = await listDocuments({
      user,
      q,
      tagRaw,
      visibilityRaw,
      statusRaw,
      sortRaw: req.query.sort,
      libraryScope,
      departmentKey,
      unionGeneralWithDepartmentId,
      fileType,
      dateFilter,
      page: 1,
      pageSize: 5000,
      includeDepartmentCounts: false,
      allScopeIncludeArchived,
      needsAttention: needsAttention || undefined,
      createdById,
    });

    const lines = [
      "id,title,visibility,isArchived,department,status,tags,createdAt,updatedAt",
      ...docs.map((d) => {
        const st = d.versions[0]?.processingStatus ?? "";
        const dept = d.department?.name ?? "General";
        const tags = d.tags.map((t) => t.name).join(";");
        const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
        return [
          d.id,
          esc(d.title),
          d.visibility,
          d.isArchived ? "yes" : "no",
          esc(dept),
          st,
          esc(tags),
          d.createdAt.toISOString(),
          d.updatedAt.toISOString(),
        ].join(",");
      }),
    ];
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="documents-export.csv"');
    res.send(lines.join("\n"));
  },
);

documentsRouter.post(
  "/bulk-delete",
  requireRole(RoleName.ADMIN),
  requireManageDocumentsCapability,
  async (req, res) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = z.object({ ids: z.array(z.string().uuid()).min(1).max(50) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Validation failed", details: body.error.flatten() });
      return;
    }

    let deleted = 0;
    for (const id of body.data.ids) {
      const doc = await prisma.document.findUnique({
        where: { id },
        include: { versions: true },
      });
      if (!doc) continue;
      if (!canManageDocument(user, doc)) continue;
      await logDocumentAudit(prisma, {
        documentId: doc.id,
        userId: user.id,
        action: DocumentAuditAction.BULK_DELETED,
        metadata: { bulk: true },
      });
      const storageKeys = doc.versions.map((v) => v.storageKey);
      await prisma.document.delete({ where: { id: doc.id } });
      for (const key of storageKeys) {
        await deleteFileIfExists(key);
      }
      deleted += 1;
    }
    res.json({ deleted });
  },
);

documentsRouter.get("/", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { page, pageSize } = parsePageParams(req.query as Record<string, unknown>);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const tagRaw = typeof req.query.tag === "string" ? req.query.tag.trim() : "";
  const visibilityRaw = typeof req.query.visibility === "string" ? req.query.visibility : "ALL";
  const statusRaw = typeof req.query.status === "string" ? req.query.status : "ALL";
  const libraryScope = parseLibraryScope(req.query.libraryScope);
  let departmentKey = typeof req.query.departmentId === "string" ? req.query.departmentId.trim() : undefined;
  if (user.role === RoleName.MANAGER) {
    if (departmentKey === "__general") {
      res.status(403).json({ error: "Managers can only view documents assigned to their department." });
      return;
    }
    if (departmentKey && departmentKey !== user.departmentId) {
      res.status(403).json({ error: "You can only filter by your own department." });
      return;
    }
  }
  const unionGeneralWithDepartmentId = unionGeneralDepartmentIdForQuery(
    user,
    req.query as Record<string, unknown>,
    departmentKey,
  );
  const fileType = typeof req.query.fileType === "string" ? req.query.fileType : "ALL";
  const dateFilter = typeof req.query.dateFilter === "string" ? req.query.dateFilter : "ALL";
  const includeMeta = req.query.includeMeta === "1" || req.query.includeMeta === "true";
  const allScopeIncludeArchived =
    user.role === RoleName.ADMIN &&
    (req.query.includeArchived === "1" || req.query.includeArchived === "true");

  const needsAttention =
    user.role === RoleName.ADMIN &&
    (req.query.needsAttention === "1" || req.query.needsAttention === "true");

  let createdById: string | undefined;
  if (user.role === RoleName.ADMIN && typeof req.query.createdById === "string") {
    const c = req.query.createdById.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(c)) {
      createdById = c;
    }
  }

  const { documents: docs, total, departmentCounts } = await listDocuments({
    user,
    q,
    tagRaw,
    visibilityRaw,
    statusRaw,
    sortRaw: req.query.sort,
    libraryScope,
    departmentKey,
    unionGeneralWithDepartmentId,
    fileType,
    dateFilter,
    page,
    pageSize,
    includeDepartmentCounts: includeMeta && libraryScope === "ALL",
    allScopeIncludeArchived,
    needsAttention: needsAttention || undefined,
    createdById,
  });

  const flags = await attachFavoriteFlags(user.id, docs);

  res.json({
    documents: docs.map((d, i) => mapDocumentRow(d, flags[i]!)),
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
    ...(includeMeta && departmentCounts ? { meta: { departmentCounts } } : {}),
  });
});

const patchDocumentBody = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(20000).optional().nullable(),
    visibility: z.nativeEnum(DocumentVisibility).optional(),
    departmentId: z.string().uuid().optional().nullable(),
    tags: z.array(z.string().min(1).max(80)).max(40).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: "No fields to update" });

documentsRouter.patch("/:documentId", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = patchDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  const doc = await prisma.document.findUnique({
    where: { id: req.params.documentId },
    include: { tags: { select: { name: true } } },
  });
  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (user.role === RoleName.EMPLOYEE || !canManageDocument(user, doc)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  let nextVisibility = parsed.data.visibility ?? doc.visibility;
  let nextDepartmentId =
    parsed.data.departmentId !== undefined ? parsed.data.departmentId : doc.departmentId;

  if (parsed.data.visibility === DocumentVisibility.DEPARTMENT && nextDepartmentId == null) {
    nextDepartmentId = user.departmentId;
  }
  if (nextVisibility === DocumentVisibility.DEPARTMENT && nextDepartmentId) {
    const dept = await prisma.department.findUnique({ where: { id: nextDepartmentId } });
    if (!dept) {
      res.status(400).json({ error: "Invalid department" });
      return;
    }
  }
  if (user.role !== "ADMIN" && nextDepartmentId && nextDepartmentId !== user.departmentId) {
    res.status(403).json({ error: "You can only assign documents to your own department" });
    return;
  }
  if (nextVisibility !== DocumentVisibility.DEPARTMENT) {
    nextDepartmentId = null;
  }

  const tagNames =
    parsed.data.tags != null ? parsed.data.tags.map((t) => normalizeTagName(t)).filter(Boolean) as string[] : undefined;

  const data: Prisma.DocumentUpdateInput = {};
  if (parsed.data.title != null) data.title = parsed.data.title.trim();
  if (parsed.data.description !== undefined) data.description = parsed.data.description?.trim() || null;
  if (parsed.data.visibility != null) {
    data.visibility = nextVisibility;
    if (nextVisibility === DocumentVisibility.DEPARTMENT && nextDepartmentId) {
      data.department = { connect: { id: nextDepartmentId } };
    } else {
      data.department = { disconnect: true };
    }
  } else if (parsed.data.departmentId !== undefined && doc.visibility === DocumentVisibility.DEPARTMENT) {
    data.department = nextDepartmentId ? { connect: { id: nextDepartmentId } } : { disconnect: true };
  }
  if (tagNames != null) {
    if (tagNames.length > 0) {
      for (const name of tagNames) {
        await prisma.documentTag.upsert({
          where: { name },
          create: { name },
          update: {},
        });
      }
      data.tags = { set: tagNames.map((name) => ({ name })) };
    } else {
      data.tags = { set: [] };
    }
  }

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data,
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      createdBy: { select: { id: true, name: true, email: true } },
      tags: { select: { name: true } },
    },
  });

  await logDocumentAudit(prisma, {
    documentId: doc.id,
    userId: user.id,
    action: DocumentAuditAction.UPDATED,
    metadata: { fields: Object.keys(parsed.data) },
  });

  res.json({
    document: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      visibility: updated.visibility,
      departmentId: updated.departmentId,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      createdBy: updated.createdBy,
      tags: updated.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
      versions: updated.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        fileName: v.fileName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        processingStatus: v.processingStatus,
        processingProgress: v.processingProgress,
        processingError: v.processingError,
        createdAt: v.createdAt,
      })),
    },
  });
});

documentsRouter.post("/:documentId/view", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
  if (!doc || !canReadDocument(user, doc)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.documentUserRecent.upsert({
    where: { userId_documentId: { userId: user.id, documentId: doc.id } },
    create: { userId: user.id, documentId: doc.id },
    update: { lastViewedAt: new Date() },
  });
  await logDocumentAudit(prisma, {
    documentId: doc.id,
    userId: user.id,
    action: DocumentAuditAction.VIEWED,
    metadata: {},
  });
  res.status(204).send();
});

documentsRouter.post("/:documentId/favorite", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
  if (!doc || !canReadDocument(user, doc)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.documentUserFavorite.upsert({
    where: { userId_documentId: { userId: user.id, documentId: doc.id } },
    create: { userId: user.id, documentId: doc.id },
    update: {},
  });
  await logDocumentAudit(prisma, {
    documentId: doc.id,
    userId: user.id,
    action: DocumentAuditAction.FAVORITED,
    metadata: {},
  });
  res.status(204).send();
});

documentsRouter.delete("/:documentId/favorite", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
  if (!doc || !canReadDocument(user, doc)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await prisma.documentUserFavorite.deleteMany({
    where: { userId: user.id, documentId: doc.id },
  });
  await logDocumentAudit(prisma, {
    documentId: doc.id,
    userId: user.id,
    action: DocumentAuditAction.UNFAVORITED,
    metadata: {},
  });
  res.status(204).send();
});

documentsRouter.post(
  "/:documentId/archive",
  requireRole(RoleName.ADMIN, RoleName.MANAGER),
  requireManageDocumentsCapability,
  async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
  if (!doc || !canReadDocument(user, doc)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canManageDocument(user, doc)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await prisma.document.update({
    where: { id: doc.id },
    data: { isArchived: true },
  });
  await logDocumentAudit(prisma, {
    documentId: doc.id,
    userId: user.id,
    action: DocumentAuditAction.ARCHIVED,
    metadata: {},
  });
  res.status(204).send();
  },
);

documentsRouter.delete(
  "/:documentId/archive",
  requireRole(RoleName.ADMIN, RoleName.MANAGER),
  requireManageDocumentsCapability,
  async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
  if (!doc || !canReadDocument(user, doc)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canManageDocument(user, doc)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  await prisma.document.update({
    where: { id: doc.id },
    data: { isArchived: false },
  });
  await logDocumentAudit(prisma, {
    documentId: req.params.documentId,
    userId: user.id,
    action: DocumentAuditAction.UNARCHIVED,
    metadata: {},
  });
  res.status(204).send();
  },
);

documentsRouter.get("/:documentId/audit", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (user.role === RoleName.EMPLOYEE) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params.documentId } });
  if (!doc || !canReadDocument(user, doc)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const logs = await prisma.documentAuditLog.findMany({
    where: { documentId: doc.id },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  const entries = logs.map((l) => ({
    id: l.id,
    action: l.action,
    metadata: l.metadata,
    createdAt: l.createdAt,
    user: l.user ? { id: l.user.id, name: l.user.name, email: l.user.email } : null,
  }));
  res.json({ entries });
});

documentsRouter.get("/:documentId", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const doc = await prisma.document.findUnique({
    where: { id: req.params.documentId },
    include: {
      versions: { orderBy: { versionNumber: "desc" } },
      createdBy: { select: { id: true, name: true, email: true } },
      tags: { select: { name: true } },
    },
  });

  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!canReadDocument(user, doc)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const canManage = user.role !== RoleName.EMPLOYEE && canManageDocument(user, doc);
  const canViewAudit = user.role !== RoleName.EMPLOYEE;

  res.json({
    document: {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      visibility: doc.visibility,
      departmentId: doc.departmentId,
      isArchived: doc.isArchived,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      createdBy: doc.createdBy,
      tags: doc.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
      versions: doc.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        fileName: v.fileName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        processingStatus: v.processingStatus,
        processingProgress: v.processingProgress,
        processingError: canManage ? v.processingError : null,
        createdAt: v.createdAt,
      })),
    },
    canManage,
    canViewAudit,
  });
});

documentsRouter.post(
  "/:documentId/versions/:versionId/reprocess",
  requireManageDocumentsCapability,
  async (req, res) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const version = await prisma.documentVersion.findUnique({
      where: { id: req.params.versionId },
      include: { document: true },
    });
    if (!version || version.documentId !== req.params.documentId) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (user.role === RoleName.EMPLOYEE || !canManageDocument(user, version.document)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await prisma.documentChunk.deleteMany({ where: { documentVersionId: version.id } });
    await prisma.documentVersion.update({
      where: { id: version.id },
      data: { processingStatus: "PENDING", processingError: null },
    });
    await enqueueDocumentIngest(version.id);
    await logDocumentAudit(prisma, {
      documentId: version.documentId,
      userId: user.id,
      action: DocumentAuditAction.REPROCESS_REQUESTED,
      metadata: { versionId: version.id },
    });
    res.json({ ok: true });
  },
);

documentsRouter.post(
  "/:documentId/versions",
  requireManageDocumentsCapability,
  (req, res, next) => {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        res.status(400).json({ error: msg });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const user = req.authUser;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Missing file field (multipart name: file)" });
      return;
    }

    const documentId = req.params.documentId;
    const doc = await prisma.document.findUnique({ where: { id: documentId } });

    if (!doc) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    if (user.role === RoleName.EMPLOYEE || !canManageDocument(user, doc)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const mimeType = resolveMimeType(file.originalname, file.mimetype);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const storageKey = allocateStorageKey(user.departmentId, file.originalname);

    await saveUploadedFile(storageKey, file.buffer);

    try {
      const agg = await prisma.documentVersion.aggregate({
        where: { documentId },
        _max: { versionNumber: true },
      });
      const nextNum = (agg._max.versionNumber ?? 0) + 1;

      const version = await prisma.documentVersion.create({
        data: {
          documentId,
          versionNumber: nextNum,
          fileName: file.originalname,
          mimeType,
          storageKey,
          sizeBytes: file.size,
          sha256,
          createdById: user.id,
        },
      });

      await prisma.document.update({
        where: { id: documentId },
        data: { updatedAt: new Date() },
      });

      await enqueueDocumentIngest(version.id);

      await logDocumentAudit(prisma, {
        documentId,
        userId: user.id,
        action: DocumentAuditAction.VERSION_UPLOADED,
        metadata: { versionId: version.id, versionNumber: version.versionNumber },
      });

      res.status(201).json({
        version: {
          id: version.id,
          versionNumber: version.versionNumber,
          processingStatus: version.processingStatus,
          processingProgress: version.processingProgress,
          fileName: version.fileName,
        },
      });
    } catch (e) {
      await deleteFileIfExists(storageKey);
      throw e;
    }
  },
);

documentsRouter.get("/:documentId/versions/:versionId/file", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const version = await prisma.documentVersion.findUnique({
    where: { id: req.params.versionId },
    include: { document: true },
  });

  if (!version || version.documentId !== req.params.documentId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!canReadDocument(user, version.document)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const abs = absolutePathForKey(version.storageKey);
  const inline = req.query.inline === "1" || req.query.inline === "true";
  res.setHeader("Content-Type", version.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(version.fileName)}"`,
  );
  const stream = createReadStream(abs);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "File could not be read" });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
});

documentsRouter.delete("/:documentId", async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const doc = await prisma.document.findUnique({
    where: { id: req.params.documentId },
    include: { versions: true },
  });

  if (!doc) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  if (!canManageDocument(user, doc)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await logDocumentAudit(prisma, {
    documentId: doc.id,
    userId: user.id,
    action: DocumentAuditAction.DELETED,
    metadata: { title: doc.title },
  });

  const storageKeys = doc.versions.map((v) => v.storageKey);

  await prisma.document.delete({ where: { id: doc.id } });

  for (const key of storageKeys) {
    await deleteFileIfExists(key);
  }

  res.status(204).send();
});
