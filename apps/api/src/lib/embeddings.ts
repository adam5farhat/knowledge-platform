import { GoogleGenerativeAI, TaskType } from "@google/generative-ai";
import { TtlCache, withRetry } from "./cache.js";
import { config } from "./config.js";

const MODEL = config.gemini.embeddingModel;
const DIM = 768;

const embedCache = new TtlCache<number[]>(600, 300);

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = config.gemini.apiKey;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set; embeddings are required for the RAG pipeline.");
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

export const EMBEDDING_DIMENSIONS = DIM;

export async function embedTexts(texts: string[], taskType: TaskType = TaskType.RETRIEVAL_DOCUMENT): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });
  const batchSize = 100;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const result = await withRetry(() => model.batchEmbedContents({
      requests: slice.map((text) => ({
        content: { role: "user", parts: [{ text }] },
        taskType,
        outputDimensionality: DIM,
      })),
    }));
    for (const emb of result.embeddings) {
      if (!emb.values || emb.values.length !== DIM) {
        throw new Error(`Unexpected embedding length: expected ${DIM}, got ${emb.values?.length}`);
      }
      out.push(emb.values);
    }
  }

  return out;
}

export async function embedQuery(query: string): Promise<number[]> {
  const cacheKey = `q:${query.trim().toLowerCase()}`;
  const cached = embedCache.get(cacheKey);
  if (cached) return cached;

  const result = await embedTexts([query], TaskType.RETRIEVAL_QUERY);
  const vec = result[0];
  if (!vec) throw new Error("Embedding API returned empty result");
  embedCache.set(cacheKey, vec);
  return vec;
}
