import type { Prisma } from "@prisma/client";
import { DocumentProcessingStatus, DocumentVisibility } from "@prisma/client";
import type { AuthContext } from "./documentAccess.js";
import { prisma } from "./prisma.js";
import { normalizeTagName } from "./tags.js";

export type LibraryScope = "ALL" | "RECENT" | "FAVORITES" | "ARCHIVED";

export function visibilityWhereForUser(user: AuthContext): Prisma.DocumentWhereInput {
  if (user.role === "ADMIN") {
    return {};
  }
  return {
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
}

/** Archive is document-level: same library visibility for every user. */
export function applyLibraryScope(
  user: AuthContext,
  scope: LibraryScope,
  accessWhere: Prisma.DocumentWhereInput,
): Prisma.DocumentWhereInput {
  const userId = user.id;
  const access = Object.keys(accessWhere).length === 0 ? {} : accessWhere;

  switch (scope) {
    case "ARCHIVED":
      return {
        AND: [access, { isArchived: true }],
      };
    case "FAVORITES":
      return {
        AND: [access, { favoritedBy: { some: { userId } } }, { isArchived: false }],
      };
    case "RECENT":
      return {
        AND: [access, { viewedBy: { some: { userId } } }, { isArchived: false }],
      };
    case "ALL":
    default:
      return {
        AND: [access, { isArchived: false }],
      };
  }
}

export function parseLibraryScope(raw: unknown): LibraryScope {
  const s = typeof raw === "string" ? raw.toUpperCase() : "ALL";
  if (s === "RECENT" || s === "FAVORITES" || s === "ARCHIVED") return s;
  return "ALL";
}

export function departmentFilterWhere(raw: unknown): Prisma.DocumentWhereInput | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  if (raw === "__general") return { departmentId: null };
  return { departmentId: raw };
}

export function fileTypeWhere(fileType: string): Prisma.DocumentWhereInput | null {
  switch (fileType) {
    case "PDF":
      return {
        versions: {
          some: {
            OR: [
              { fileName: { endsWith: ".pdf", mode: "insensitive" } },
              { mimeType: "application/pdf" },
            ],
          },
        },
      };
    case "DOC":
      return {
        versions: {
          some: {
            OR: [
              { fileName: { endsWith: ".doc", mode: "insensitive" } },
              { fileName: { endsWith: ".docx", mode: "insensitive" } },
            ],
          },
        },
      };
    case "TXT":
      return {
        versions: {
          some: {
            OR: [
              { fileName: { endsWith: ".txt", mode: "insensitive" } },
              { mimeType: { startsWith: "text/" } },
            ],
          },
        },
      };
    case "IMG":
      return {
        versions: {
          some: {
            OR: [
              { fileName: { endsWith: ".png", mode: "insensitive" } },
              { fileName: { endsWith: ".jpg", mode: "insensitive" } },
              { fileName: { endsWith: ".jpeg", mode: "insensitive" } },
              { fileName: { endsWith: ".gif", mode: "insensitive" } },
              { fileName: { endsWith: ".webp", mode: "insensitive" } },
              { mimeType: { startsWith: "image/" } },
            ],
          },
        },
      };
    default:
      return null;
  }
}

export function createdAtFromDateFilter(filter: string): Date | null {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (filter === "TODAY") return new Date(now - day);
  if (filter === "WEEK") return new Date(now - 7 * day);
  if (filter === "MONTH") return new Date(now - 30 * day);
  return null;
}

const docListInclude = {
  versions: { orderBy: { versionNumber: "desc" as const }, take: 1 },
  createdBy: { select: { id: true, name: true, email: true, profilePictureUrl: true } },
  department: { select: { name: true } },
  tags: { select: { name: true } },
} satisfies Prisma.DocumentInclude;

export type DocumentListInclude = typeof docListInclude;

export { docListInclude };

export function parseDocumentListSort(raw: unknown): Prisma.DocumentOrderByWithRelationInput {
  const s = typeof raw === "string" ? raw : "updatedAt_desc";
  switch (s) {
    case "updatedAt_asc":
      return { updatedAt: "asc" };
    case "title_asc":
      return { title: "asc" };
    case "title_desc":
      return { title: "desc" };
    case "updatedAt_desc":
    default:
      return { updatedAt: "desc" };
  }
}

export type ListDocumentsParams = {
  user: AuthContext;
  q: string;
  tagRaw: string;
  visibilityRaw: string;
  statusRaw: string;
  sortRaw: unknown;
  libraryScope: LibraryScope;
  departmentKey: string | undefined;
  fileType: string;
  dateFilter: string;
  page: number;
  pageSize: number;
  includeDepartmentCounts: boolean;
  /** Admin-only: when scope is ALL, do not exclude archived documents. */
  allScopeIncludeArchived?: boolean;
};

export async function listDocuments(p: ListDocumentsParams): Promise<{
  documents: Prisma.DocumentGetPayload<{ include: typeof docListInclude }>[];
  total: number;
  departmentCounts: { id: string; name: string; count: number }[] | undefined;
}> {
  if (p.user.accessDocumentsAllowed === false) {
    return { documents: [], total: 0, departmentCounts: undefined };
  }

  const access = visibilityWhereForUser(p.user);
  const scoped =
    p.allScopeIncludeArchived === true &&
    p.libraryScope === "ALL" &&
    p.user.role === "ADMIN"
      ? Object.keys(access).length === 0
        ? {}
        : { AND: [access] }
      : applyLibraryScope(p.user, p.libraryScope, access);
  const andParts: Prisma.DocumentWhereInput[] = [scoped];

  if (p.q.length > 0) {
    andParts.push({
      OR: [
        { title: { contains: p.q, mode: "insensitive" } },
        { description: { contains: p.q, mode: "insensitive" } },
      ],
    });
  }

  if (p.tagRaw.length > 0) {
    const normalizedTag = normalizeTagName(p.tagRaw);
    if (normalizedTag) {
      andParts.push({ tags: { some: { name: normalizedTag } } });
    }
  }

  if (p.visibilityRaw !== "ALL") {
    const v = Object.values(DocumentVisibility).find((x) => x === p.visibilityRaw);
    if (v) {
      andParts.push({ visibility: v });
    }
  }

  const deptW = departmentFilterWhere(p.departmentKey ?? "");
  if (deptW) {
    andParts.push(deptW);
  }

  const ft = fileTypeWhere(p.fileType);
  if (ft) {
    andParts.push(ft);
  }

  const d0 = createdAtFromDateFilter(p.dateFilter);
  if (d0) {
    andParts.push({ createdAt: { gte: d0 } });
  }

  if (p.statusRaw !== "ALL") {
    const st = Object.values(DocumentProcessingStatus).find((x) => x === p.statusRaw);
    if (st) {
      andParts.push({ versions: { some: { processingStatus: st } } });
    }
  }

  const where: Prisma.DocumentWhereInput =
    andParts.length === 1 ? andParts[0]! : { AND: andParts };

  const orderBy = parseDocumentListSort(p.sortRaw);

  if (p.libraryScope === "RECENT") {
    const total = await prisma.documentUserRecent.count({
      where: { userId: p.user.id, document: where },
    });
    const recentRows = await prisma.documentUserRecent.findMany({
      where: { userId: p.user.id, document: where },
      orderBy: { lastViewedAt: "desc" },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      include: { document: { include: docListInclude } },
    });
    const documents = recentRows.map((r) => r.document);
    return {
      documents,
      total,
      departmentCounts: p.includeDepartmentCounts
        ? await computeDepartmentCounts(p.user, access)
        : undefined,
    };
  }

  if (p.libraryScope === "FAVORITES") {
    const total = await prisma.documentUserFavorite.count({
      where: { userId: p.user.id, document: where },
    });
    const favRows = await prisma.documentUserFavorite.findMany({
      where: { userId: p.user.id, document: where },
      orderBy: { createdAt: "desc" },
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      include: { document: { include: docListInclude } },
    });
    const documents = favRows.map((r) => r.document);
    return {
      documents,
      total,
      departmentCounts: p.includeDepartmentCounts
        ? await computeDepartmentCounts(p.user, access)
        : undefined,
    };
  }

  const total = await prisma.document.count({ where });
  const documents = await prisma.document.findMany({
    where,
    orderBy,
    skip: (p.page - 1) * p.pageSize,
    take: p.pageSize,
    include: docListInclude,
  });

  return {
    documents,
    total,
    departmentCounts:
      p.includeDepartmentCounts && p.libraryScope === "ALL"
        ? await computeDepartmentCounts(p.user, access)
        : undefined,
  };
}

async function computeDepartmentCounts(
  user: AuthContext,
  access: Prisma.DocumentWhereInput,
): Promise<{ id: string; name: string; count: number }[]> {
  const baseWhere = applyLibraryScope(user, "ALL", access);
  const docs = await prisma.document.findMany({
    where: baseWhere,
    select: {
      departmentId: true,
      department: { select: { name: true } },
    },
  });
  const map = new Map<string, { id: string; name: string; count: number }>();
  for (const d of docs) {
    const id = d.departmentId ?? "__general";
    const name = d.department?.name ?? (d.departmentId ? "Department" : "General");
    const prev = map.get(id);
    map.set(id, { id, name, count: (prev?.count ?? 0) + 1 });
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function mapDocumentRow(
  d: Prisma.DocumentGetPayload<{ include: typeof docListInclude }>,
  extras: { isFavorited: boolean },
) {
  return {
    id: d.id,
    title: d.title,
    description: d.description,
    visibility: d.visibility,
    departmentId: d.departmentId,
    departmentName: d.department?.name ?? null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    createdBy: d.createdBy,
    tags: d.tags.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
    isFavorited: extras.isFavorited,
    isArchived: d.isArchived,
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
  };
}
