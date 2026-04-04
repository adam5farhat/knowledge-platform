import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const DIM = 768;

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("GEMINI_API_KEY is not set; embeddings are required for the RAG pipeline.");
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(key);
  }
  return genAI;
}

export const EMBEDDING_DIMENSIONS = DIM;

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const client = getClient();
  const model = client.getGenerativeModel({ model: MODEL });
  const batchSize = 100;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const result = await model.batchEmbedContents({
      requests: slice.map((text) => ({
        content: { role: "user", parts: [{ text }] },
        outputDimensionality: DIM,
      })),
    });
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
  const [vec] = await embedTexts([query]);
  return vec;
}
