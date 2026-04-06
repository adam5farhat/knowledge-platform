import type { ZodType, ZodTypeDef } from "zod";
import { AppError } from "./AppError.js";

/**
 * Parse `data` against `schema` and return the typed result.
 * Throws `AppError.badRequest` with flattened Zod details on failure,
 * which the global error handler maps to a 400 JSON response.
 */
export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw AppError.badRequest("Validation failed", undefined, parsed.error.flatten());
  }
  return parsed.data;
}
