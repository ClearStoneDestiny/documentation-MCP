import * as z from "zod/v4";

export const cacheEntrySchema = z.object({
  schemaVersion: z.literal(1),
  url: z.string().url(),
  content: z.string().refine((value) => value.trim().length > 0),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  fetchedAt: z.iso.datetime(),
  checkedAt: z.iso.datetime(),
  etag: z
    .string()
    .regex(/^[^\r\n]*$/)
    .optional(),
  lastModified: z
    .string()
    .regex(/^[^\r\n]*$/)
    .optional(),
});

export const cacheInfoSchema = z.object({
  status: z.enum([
    "disabled",
    "miss",
    "hit",
    "revalidated",
    "updated",
    "stale",
  ]),
  checkedAt: z.string(),
  persisted: z.boolean(),
  warning: z.string().optional(),
});

export type TCacheEntry = z.infer<typeof cacheEntrySchema>;
export type TCacheInfo = z.infer<typeof cacheInfoSchema>;
