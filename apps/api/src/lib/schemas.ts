import { z } from "zod";

export const bulkIdsSchema = z.array(z.string().uuid()).min(1).max(50);
export const chatRoleEnum = z.enum(["user", "assistant"]);
