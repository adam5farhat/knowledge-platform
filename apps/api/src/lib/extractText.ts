import { createRequire } from "node:module";
import { GoogleGenerativeAI } from "@google/generative-ai";
import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { config } from "./config.js";
import { logger } from "./logger.js";
import mammoth from "mammoth";
import mime from "mime-types";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);
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
    const text = await extractPdfText(buffer);
    return normalizeText(text);
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

const COMMON_WORDS = new Set([
  "the", "and", "for", "that", "this", "with", "from", "have", "are",
  "was", "were", "been", "being", "which", "their", "will", "would",
  "shall", "should", "not", "but", "all", "can", "has", "its", "may",
]);

/**
 * Returns true when extracted text appears garbled — e.g. PDFs with broken
 * Type3 font encodings that produce Caesar-shifted characters.
 */
function looksLikeGarbledText(text: string): boolean {
  if (text.length < 100) return false;
  const words = text.toLowerCase().replace(/[^a-z\s]/g, "").split(/\s+/).filter(w => w.length >= 3);
  if (words.length === 0) return true;
  const hits = words.filter((w) => COMMON_WORDS.has(w)).length;
  return hits / words.length < 0.02;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const data = await parser.getText();
    const text = data.text;
    if (text.length > 50 && !looksLikeGarbledText(text)) {
      return text;
    }
  } finally {
    await parser.destroy();
  }

  const apiKey = config.gemini.apiKey;
  if (!apiKey) {
    throw new Error(
      "PDF has broken font encoding and GEMINI_API_KEY is not set for OCR fallback.",
    );
  }
  const MAX_OCR_BYTES = 20 * 1024 * 1024;
  if (buffer.length > MAX_OCR_BYTES) {
    throw new Error(
      `PDF is ${Math.round(buffer.length / 1024 / 1024)}MB — too large for OCR fallback (limit ${MAX_OCR_BYTES / 1024 / 1024}MB).`,
    );
  }

  logger.info("PDF text appears garbled — falling back to Gemini OCR");
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: config.gemini.chatModel });
  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: "application/pdf",
        data: buffer.toString("base64"),
      },
    },
    {
      text:
        "Extract ALL text from this PDF document. Return ONLY the raw text " +
        "content, preserving the original structure (headings, paragraphs, " +
        "lists, numbering). Do not summarize, interpret, or add anything. " +
        "Output the full text exactly as it appears in the document.",
    },
  ]);
  return result.response.text();
}
