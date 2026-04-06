export const MAX_UPLOAD_TAGS = 24;
export const TAG_NAME_RE = /^[a-z0-9]+(?:[ .+_-][a-z0-9]+)*$/;
export const TABLE_TAGS_VISIBLE = 3;
export type DocRow = {
  id: string;
  title: string;
  description?: string | null;
  visibility: string;
  departmentId: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt?: string;
  createdBy: { name: string; email: string };
  tags: string[];
  isFavorited?: boolean;
  isArchived?: boolean;
  latestVersion: {
    id: string;
    versionNumber: number;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    processingStatus: string;
    processingProgress: number;
    processingError: string | null;
    createdAt: string;
  } | null;
};

export type LibraryScope = "ALL" | "RECENT" | "FAVORITES" | "ARCHIVED";
export type Dept = { id: string; name: string };
