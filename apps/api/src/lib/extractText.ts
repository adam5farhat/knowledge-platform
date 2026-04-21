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
    return normalizeText(await extractDocxText(buffer));
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

  if (mt === "text/csv") {
    return normalizeText(extractCsvText(buffer));
  }

  if (mt === "text/plain" || mt === "text/markdown") {
    return normalizeText(buffer.toString("utf8"));
  }

  if (mt === "text/html") {
    return normalizeText(extractHtmlPreservingTables(buffer.toString("utf8")));
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
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    const xml = await zip.file(name)?.async("string");
    if (!xml) continue;
    // Each <a:p> is a paragraph in PowerPoint; preserve the boundary as a
    // newline so titles, bullets, and notes don't fuse into one giant string.
    const paragraphs = [...xml.matchAll(/<a:p[\s\S]*?<\/a:p>/g)]
      .map((p) => {
        const runs = [...p[0].matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("");
        return runs.trim();
      })
      .filter((s) => s.length > 0);
    if (paragraphs.length === 0) continue;
    // First paragraph is almost always the slide title; mark it as a heading
    // so the chunker uses it as a section title instead of mid-chunking it.
    const slideNo = i + 1;
    const [first, ...rest] = paragraphs;
    parts.push(`## Slide ${slideNo}: ${first}\n\n${rest.join("\n")}`.trim());
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

/**
 * Render a 2D array of cells as a GitHub-flavoured markdown table.
 * Returns null when the input is empty or has no header row.
 *
 * Markdown tables survive chunking better than TSV because the chunker
 * recognises pipe-delimited rows and refuses to split mid-table.
 */
function rowsToMarkdownTable(rows: unknown[][]): string | null {
  const cleaned = rows
    .map((r) => r.map((c) => (c == null ? "" : String(c).replace(/\|/g, "\\|").replace(/\n/g, " ").trim())))
    .filter((r) => r.some((c) => c.length > 0));
  if (cleaned.length === 0) return null;

  const cols = Math.max(...cleaned.map((r) => r.length));
  if (cols === 0) return null;

  const header = cleaned[0]!;
  while (header.length < cols) header.push("");

  const lines: string[] = [];
  lines.push("| " + header.join(" | ") + " |");
  lines.push("| " + Array(cols).fill("---").join(" | ") + " |");
  for (let i = 1; i < cleaned.length; i++) {
    const row = cleaned[i]!.slice();
    while (row.length < cols) row.push("");
    lines.push("| " + row.join(" | ") + " |");
  }
  return lines.join("\n");
}

/**
 * Parse a CSV buffer into a markdown table so the chunker keeps it intact and
 * the embedder gets header context for each row.
 *
 * Falls back to the raw UTF-8 string if parsing fails or the file is not a
 * well-formed table.
 */
function extractCsvText(buffer: Buffer): string {
  try {
    const wb = XLSX.read(buffer.toString("utf8"), { type: "string", raw: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return buffer.toString("utf8");
    const sheet = wb.Sheets[sheetName];
    if (!sheet) return buffer.toString("utf8");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
    const md = rowsToMarkdownTable(rows);
    return md ?? buffer.toString("utf8");
  } catch {
    return buffer.toString("utf8");
  }
}

function extractSpreadsheetText(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const out: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false, defval: "" });
    const md = rowsToMarkdownTable(rows);
    if (md) {
      out.push(`## ${sheetName}\n\n${md}`);
    } else {
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
      out.push(`## ${sheetName}\n${csv}`);
    }
  }
  return out.join("\n\n");
}

/**
 * HTML extractor that converts <table> elements to markdown tables before
 * stripping the rest of the markup. Preserves headings as `## ` so the
 * downstream chunker can use them as section titles.
 */
function extractHtmlPreservingTables(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content nodes that would otherwise leak into chunks.
  $("script, style, noscript, nav, header, footer").remove();

  $("table").each((_, el) => {
    const rows: string[][] = [];
    $(el)
      .find("tr")
      .each((__, tr) => {
        const cells: string[] = [];
        $(tr)
          .find("th, td")
          .each((___, td) => {
            cells.push($(td).text().replace(/\s+/g, " ").trim());
          });
        if (cells.some((c) => c.length > 0)) rows.push(cells);
      });
    const md = rowsToMarkdownTable(rows);
    if (md) {
      // Wrap with blank lines so chunkText sees this as its own paragraph
      // and the isTableParagraph check kicks in.
      $(el).replaceWith(`\n\n${md}\n\n`);
    }
  });

  $("h1,h2,h3,h4,h5,h6").each((_, el) => {
    const text = $(el).text().trim();
    if (text) $(el).replaceWith(`\n\n## ${text}\n\n`);
  });

  return $("body").length > 0 ? $("body").text() : $.root().text();
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

/**
 * Render JSON as `key: value` lines so the embedder sees both the field name
 * and the value (the field name is often the most informative half — e.g.
 * `policyName`, `effectiveDate`, `owner`).
 *
 * Falls back to the raw string when the JSON is invalid.
 */
function extractJsonStrings(json: string): string {
  try {
    const v = JSON.parse(json) as unknown;
    const lines: string[] = [];
    const walk = (x: unknown, path: string): void => {
      if (x == null) return;
      if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") {
        const val = String(x).trim();
        if (val.length === 0) return;
        lines.push(path ? `${path}: ${val}` : val);
        return;
      }
      if (Array.isArray(x)) {
        x.forEach((item, i) => walk(item, path ? `${path}[${i}]` : `[${i}]`));
        return;
      }
      if (typeof x === "object") {
        for (const [k, val] of Object.entries(x as Record<string, unknown>)) {
          walk(val, path ? `${path}.${k}` : k);
        }
      }
    };
    walk(v, "");
    return lines.join("\n");
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

/**
 * DOCX → text with headings and tables preserved.
 *
 * `mammoth.extractRawText` flattens everything to a single string and loses
 * heading levels and table boundaries, which kills section-aware chunking and
 * makes tables impossible for the chunker to keep intact.
 *
 * We instead convert to HTML (mammoth knows how to map Word styles to
 * `<h1>..<h6>` and `<table>`), then funnel that through the same
 * `extractHtmlPreservingTables` pipeline used for HTML uploads. As a safety
 * net we fall back to raw text if the HTML pass throws.
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const { value: html } = await mammoth.convertToHtml({ buffer });
    if (html && html.length > 0) {
      return extractHtmlPreservingTables(html);
    }
  } catch (err) {
    logger.warn("DOCX HTML conversion failed, falling back to raw text", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
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
