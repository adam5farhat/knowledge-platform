import { createRequire } from "node:module";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import mammoth from "mammoth";
import mime from "mime-types";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const WordExtractor = require("word-extractor") as { new (): { extract: (b: Buffer) => Promise<{ getBody: () => string }> } };

const wordExtractor = new WordExtractor();

const XML = new XMLParser({ ignoreAttributes: false, trimValues: true });

/** MIME types we accept for upload + extraction (aligned with routes whitelist). */
export const SUPPORTED_EXTRACTION_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "text/xml",
  "application/xml",
  "application/json",
  "application/rtf",
  "text/rtf",
  "application/vnd.oasis.opendocument.text",
]);

export function resolveMimeType(fileName: string, declaredMime: string | undefined): string {
  const fromName = mime.lookup(fileName);
  if (fromName && SUPPORTED_EXTRACTION_MIMES.has(fromName)) {
    return fromName;
  }
  if (declaredMime && SUPPORTED_EXTRACTION_MIMES.has(declaredMime)) {
    return declaredMime;
  }
  if (fromName) return fromName;
  return declaredMime ?? "application/octet-stream";
}

export async function extractPlainText(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const mt = mimeType.toLowerCase();

  if (mt === "application/pdf") {
    const data = await pdfParse(buffer);
    return normalizeText(data.text);
  }

  if (mt === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const { value } = await mammoth.extractRawText({ buffer });
    return normalizeText(value);
  }

  if (mt === "application/msword") {
    const doc = await wordExtractor.extract(buffer);
    return normalizeText(doc.getBody());
  }

  if (mt === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
    return normalizeText(await extractPptxText(buffer));
  }

  if (mt === "application/vnd.ms-powerpoint") {
    throw new Error("Legacy .ppt is not supported; please save as .pptx and upload again.");
  }

  if (mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mt === "application/vnd.ms-excel") {
    return normalizeText(extractSpreadsheetText(buffer));
  }

  if (mt === "text/plain" || mt === "text/markdown" || mt === "text/csv") {
    return normalizeText(buffer.toString("utf8"));
  }

  if (mt === "text/html") {
    return normalizeText(cheerio.load(buffer.toString("utf8")).text());
  }

  if (mt === "text/xml" || mt === "application/xml") {
    return normalizeText(extractXmlPlainText(buffer.toString("utf8")));
  }

  if (mt === "application/json") {
    return normalizeText(extractJsonStrings(buffer.toString("utf8")));
  }

  if (mt === "application/rtf" || mt === "text/rtf") {
    return normalizeText(stripRtf(buffer.toString("latin1")));
  }

  if (mt === "application/vnd.oasis.opendocument.text") {
    return normalizeText(await extractOdtText(buffer));
  }

  throw new Error(`No text extractor for MIME type ${mimeType} (${fileName})`);
}

function normalizeText(s: string): string {
  return s.replace(/\u0000/g, "").replace(/\s+\n/g, "\n").trim();
}

async function extractPptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files)
    .filter((n) => /ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number.parseInt(/slide(\d+)/i.exec(a)?.[1] ?? "0", 10);
      const nb = Number.parseInt(/slide(\d+)/i.exec(b)?.[1] ?? "0", 10);
      return na - nb;
    });

  const parts: string[] = [];
  for (const name of names) {
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    const matches = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)];
    const text = matches
      .map((m) => m[1])
      .join("")
      .trim();
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

function collectTextNodes(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collectTextNodes);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o["a:t"] === "string") return [o["a:t"]];
    if (Array.isArray(o["a:t"])) return o["a:t"].flatMap(collectTextNodes);
    return Object.values(o).flatMap(collectTextNodes);
  }
  return [];
}

function extractSpreadsheetText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const lines: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    lines.push(`## ${sheetName}\n${csv}`);
  }
  return lines.join("\n\n");
}

function extractXmlPlainText(xml: string): string {
  try {
    const doc = XML.parse(xml);
    const texts = collectTextNodes(doc);
    return texts.join(" ");
  } catch {
    return xml.replace(/<[^>]+>/g, " ");
  }
}

function extractJsonStrings(json: string): string {
  try {
    const v = JSON.parse(json) as unknown;
    const out: string[] = [];
    const walk = (x: unknown): void => {
      if (typeof x === "string") out.push(x);
      else if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") Object.values(x as object).forEach(walk);
    };
    walk(v);
    return out.join("\n");
  } catch {
    return json;
  }
}

/** Minimal RTF stripping for plain-text fallback. */
function stripRtf(s: string): string {
  let t = s.replace(/\{\\\*[^}]*\}/g, "");
  t = t.replace(/\\'[0-9a-fA-F]{2}/g, (m) => {
    const hex = m.slice(2);
    return String.fromCharCode(Number.parseInt(hex, 16));
  });
  t = t.replace(/\\[a-z]+\d* ?/gi, "");
  t = t.replace(/[{}]/g, "");
  return t;
}

async function extractOdtText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const content = await zip.file("content.xml")?.async("string");
  if (!content) throw new Error("Invalid ODT: missing content.xml");
  const doc = XML.parse(content);
  const texts = collectTextNodes(doc);
  return texts.join("\n");
}
