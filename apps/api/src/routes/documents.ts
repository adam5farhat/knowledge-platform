import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { Router } from "express";
import multer from "multer";
import { DocumentVisibility } from "@prisma/client";
import { z } from "zod";
import { authenticateToken } from "../middleware/auth.js";
import { canManageDocument, canReadDocument } from "../lib/documentAccess.js";
import { prisma } from "../lib/prisma.js";
import {
  allocateStorageKey,
  absolutePathForKey,
  deleteFileIfExists,
  saveUploadedFile,
} from "../lib/storage.js";
import { resolveMimeType, SUPPORTED_EXTRACTION_MIMES } from "../lib/extractText.js";
import { enqueueDocumentIngest } from "../jobs/documentIngest.js";

export const documentsRouter = Router();

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
});

const listQuery = z.object({
  q: z.string().trim().optional(),
  visibility: z.nativeEnum(DocumentVisibility).optional(),
  status: z.enum(["PENDING", "PROCESSING", "READY", "FAILED"]).optional(),
  sort: z.enum(["updatedAt_desc", "updatedAt_asc", "title_asc", "title_desc"]).optional(),
});

documentsRouter.post(
  "/upload",
  authenticateToken,
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

    try {
      const doc = await prisma.document.create({
        data: {
          title: parsed.data.title.trim(),
          createdById: user.id,
          departmentId: visibility === DocumentVisibility.DEPARTMENT ? departmentId : null,
          visibility,
        },
      });

      const version = await prisma.documentVersion.create({
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

      await enqueueDocumentIngest(version.id);

      res.status(201).json({
        document: {
          id: doc.id,
          title: doc.title,
          visibility: doc.visibility,
          departmentId: doc.departmentId,
          createdAt: doc.createdAt,
        },
        version: {
          id: version.id,
          versionNumber: version.versionNumber,
          processingStatus: version.processingStatus,
          fileName: version.fileName,
        },
      });
    } catch (e) {
      await deleteFileIfExists(storageKey);
      throw e;
    }
  },
);

documentsRouter.get("/", authenticateToken, async (req, res) => {
  const user = req.authUser;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsedQuery = listQuery.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({ error: "Validation failed", details: parsedQuery.error.flatten() });
    return;
  }
  const { q, visibility, status, sort } = parsedQuery.data;

  const where =
    user.role === "ADMIN"
      ? {}
      : {
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
        };

  const whereWithFilters = {
    ...where,
    ...(q
      ? {
          title: {
            contains: q,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(visibility ? { visibility } : {}),
    ...(status
      ? {
          versions: {
            some: {
              processingStatus: status,
            },
          },
        }
      : {}),
  };

  const orderBy =
    sort === "updatedAt_asc"
      ? { updatedAt: "asc" as const }
      : sort === "title_asc"
        ? { title: "asc" as const }
        : sort === "title_desc"
          ? { title: "desc" as const }
          : { updatedAt: "desc" as const };

  const docs = await prisma.document.findMany({
    where: whereWithFilters,
    orderBy,
    include: {
      versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      createdBy: { select: { id: true, name: true, email: true } },
      department: { select: { id: true, name: true } },
    },
  });

  res.json({
    documents: docs.map((d) => ({
      id: d.id,
      title: d.title,
      visibility: d.visibility,
      departmentId: d.departmentId,
      departmentName: d.department?.name ?? null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      createdBy: d.createdBy,
      latestVersion: d.versions[0]
        ? {
            id: d.versions[0].id,
            versionNumber: d.versions[0].versionNumber,
            fileName: d.versions[0].fileName,
            mimeType: d.versions[0].mimeType,
            sizeBytes: d.versions[0].sizeBytes,
            processingStatus: d.versions[0].processingStatus,
            processingError: d.versions[0].processingError,
            createdAt: d.versions[0].createdAt,
          }
        : null,
    })),
  });
});

documentsRouter.get("/:documentId", authenticateToken, async (req, res) => {
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

  res.json({
    document: {
      id: doc.id,
      title: doc.title,
      visibility: doc.visibility,
      departmentId: doc.departmentId,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      createdBy: doc.createdBy,
      versions: doc.versions.map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        fileName: v.fileName,
        mimeType: v.mimeType,
        sizeBytes: v.sizeBytes,
        processingStatus: v.processingStatus,
        processingError: v.processingError,
        createdAt: v.createdAt,
      })),
    },
  });
});

documentsRouter.get("/:documentId/versions/:versionId/file", authenticateToken, async (req, res) => {
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
  res.setHeader("Content-Type", version.mimeType);
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(version.fileName)}"`);
  createReadStream(abs).pipe(res);
});

documentsRouter.delete("/:documentId", authenticateToken, async (req, res) => {
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

  for (const v of doc.versions) {
    await deleteFileIfExists(v.storageKey);
  }

  await prisma.document.delete({ where: { id: doc.id } });

  res.status(204).send();
});

documentsRouter.post(
  "/:documentId/versions",
  authenticateToken,
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

    const doc = await prisma.document.findUnique({
      where: { id: req.params.documentId },
      include: {
        versions: { select: { versionNumber: true } },
      },
    });
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    if (!canManageDocument(user, doc)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const mimeType = resolveMimeType(file.originalname, file.mimetype);
    const sha256 = createHash("sha256").update(file.buffer).digest("hex");
    const storageKey = allocateStorageKey(doc.departmentId ?? user.departmentId, file.originalname);
    const nextVersion = Math.max(0, ...doc.versions.map((v) => v.versionNumber)) + 1;

    await saveUploadedFile(storageKey, file.buffer);

    try {
      const version = await prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber: nextVersion,
          fileName: file.originalname,
          mimeType,
          storageKey,
          sizeBytes: file.size,
          sha256,
          createdById: user.id,
        },
      });

      await enqueueDocumentIngest(version.id);

      res.status(201).json({
        version: {
          id: version.id,
          documentId: version.documentId,
          versionNumber: version.versionNumber,
          fileName: version.fileName,
          processingStatus: version.processingStatus,
          createdAt: version.createdAt,
        },
      });
    } catch (e) {
      await deleteFileIfExists(storageKey);
      throw e;
    }
  },
);

documentsRouter.post("/:documentId/versions/:versionId/reprocess", authenticateToken, async (req, res) => {
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
    res.status(404).json({ error: "Version not found" });
    return;
  }
  if (!canManageDocument(user, version.document)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (version.processingStatus === "PROCESSING") {
    res.status(409).json({ error: "Version is already processing" });
    return;
  }

  await prisma.documentVersion.update({
    where: { id: version.id },
    data: {
      processingStatus: "PENDING",
      processingError: null,
    },
  });
  await enqueueDocumentIngest(version.id);

  res.status(202).json({ ok: true });
});
