import OpenAI from "openai";

const MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
const DIM = 1536;

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set; embeddings are required for the RAG pipeline.");
  }
  if (!client) {
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

export const EMBEDDING_DIMENSIONS = DIM;

/** Batch embeddings (OpenAI allows many inputs per request; we chunk to stay within limits). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const openai = getClient();
  const batchSize = 100;
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const res = await openai.embeddings.create({
      model: MODEL,
      input: slice,
      dimensions: DIM,
    });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const row of sorted) {
      if (!row.embedding || row.embedding.length !== DIM) {
        throw new Error(`Unexpected embedding length: expected ${DIM}`);
      }
      out.push(row.embedding);
    }
  }
  return out;
}

export async function embedQuery(query: string): Promise<number[]> {
  const [vec] = await embedTexts([query]);
  return vec;
}
