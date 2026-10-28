import * as z from "zod/v4";
import { libraryIdSchema } from "../../libraries/schemas/library-id.schema.js";
import { sourcePathSchema } from "../../sources/schemas/source-path.schema.js";
import { cacheInfoSchema } from "../../cache/schemas/cache.schema.js";

export const getDocumentationInputSchema = z
  .strictObject({
    library: libraryIdSchema,
    path: sourcePathSchema,
    section_id: z
      .string()
      .min(1)
      .max(512)
      .optional()
      .describe(
        "Internal section ID from a previous response. Includes its subsections.",
      ),
    max_chars: z
      .number()
      .int()
      .min(256)
      .max(40_000)
      .default(12_000)
      .describe(
        "Maximum Markdown characters per response; metadata and section outline are additional.",
      ),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        "Offset within the selected document or section. Use pagination.nextOffset.",
      ),
    expected_hash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe(
        "Previous contentHash. Required when offset > 0 to detect source changes.",
      ),
    refresh: z
      .boolean()
      .default(false)
      .describe(
        "Check the source now, even if the disk cache is fresh. Temporary failures may return a saved copy marked stale.",
      ),
  })
  .refine((input) => input.offset === 0 || input.expected_hash !== undefined, {
    path: ["expected_hash"],
    message: "expected_hash is required when continuing from a nonzero offset",
  });

export const getDocumentationOutputSchema = z.object({
  libraryId: libraryIdSchema,
  path: z.string(),
  sourceUrl: z.string(),
  title: z.string(),
  description: z.string().optional(),
  lastUpdated: z.string().optional(),
  fetchedAt: z.string(),
  cache: cacheInfoSchema.optional(),
  channel: z.literal("current"),
  contentHash: z.string(),
  // Branch descriptions prevent Zod from collapsing nullable unions into type arrays
  selectedSectionId: z.union([
    z.string().describe("ID of the selected section."),
    z.null().describe("The entire document is selected."),
  ]),
  sections: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      depth: z.number().int(),
      parentId: z.string().optional(),
    }),
  ),
  content: z.string(),
  pagination: z.object({
    offset: z.number().int(),
    nextOffset: z.union([
      z.number().int().describe("Offset of the next Markdown page."),
      z.null().describe("No more content remains."),
    ]),
    totalChars: z.number().int(),
    truncated: z.boolean(),
  }),
});

export type TGetDocumentationInput = z.input<
  typeof getDocumentationInputSchema
>;
export type TGetDocumentationResult = z.infer<
  typeof getDocumentationOutputSchema
>;
