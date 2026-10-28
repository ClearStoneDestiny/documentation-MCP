import * as z from "zod/v4";
import { cacheInfoSchema } from "../../cache/schemas/cache.schema.js";
import { libraryIdSchema } from "./library-id.schema.js";

export const listVersionsInputSchema = z.strictObject({
  library: libraryIdSchema,
  refresh: z.boolean().default(false),
});

const documentationSetSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  channel: z.enum(["current", "versioned"]),
  declaredVersion: z.union([
    z
      .string()
      .describe(
        "Version declared by the documentation catalog. " +
          "This is not necessarily an immutable documentation revision " +
          "or a verified compatibility range.",
      ),
    z
      .null()
      .describe(
        "The catalog does not declare a version, or it is unavailable.",
      ),
  ]),
  // Branch descriptions keep Zod from collapsing the union into a type array
  versionRange: z.union([
    z.string().describe("Compatibility range, when verified and available."),
    z.null().describe("No verified compatibility range is available."),
  ]),
  sourceUrl: z.string().url(),
});

export const listVersionsOutputSchema = z.object({
  library: libraryIdSchema,
  documentationSets: z.array(documentationSetSchema),
  catalog: z.object({
    sourceUrl: z.string().url(),
    fetchedAt: z.string(),
    cache: cacheInfoSchema.optional(),
  }),
});

export type TListVersionsInput = z.input<typeof listVersionsInputSchema>;
export type TListVersionsResult = z.infer<typeof listVersionsOutputSchema>;
