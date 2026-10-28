import * as z from "zod/v4";
import { cacheInfoSchema } from "../../cache/schemas/cache.schema.js";
import { libraryIdSchema } from "../../libraries/schemas/library-id.schema.js";
import {
  searchDocsInputSchema,
  searchDocsOutputSchema,
} from "../../search/schemas/search-docs.schema.js";

export const getCodeExamplesInputSchema = z.strictObject({
  library: libraryIdSchema,
  query: searchDocsInputSchema.shape.query,
  version: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .default("current")
    .describe(
      "Documentation set ID from list_versions, not a package release number or compatibility range. Currently only current is supported.",
    ),
  filters: z
    .strictObject({
      languages: z
        .array(z.string().trim().min(1).max(50))
        .min(1)
        .max(10)
        .optional()
        .describe(
          "Match any of these fence languages, case-insensitively. js/javascript and ts/typescript are aliases; jsx and tsx remain distinct. Untagged blocks do not match a language filter.",
        ),
      path_prefix: searchDocsInputSchema.shape.path_prefix,
    })
    .optional(),
  limit: z.number().int().min(1).max(20).default(5),
  refresh: searchDocsInputSchema.shape.refresh,
});

export const getCodeExamplesOutputSchema = z.object({
  libraryId: libraryIdSchema,
  version: z
    .literal("current")
    .describe("Selected documentation set ID, not a package version."),
  totalMatches: z.number().int().nonnegative(),
  examples: z.array(
    z.object({
      sourceUrl: z.string().url(),
      sectionTitle: z.string(),
      code: z.string(),
      language: z.string().optional(),
      meta: z.string().optional(),
      fetchedAt: z.string(),
      cache: cacheInfoSchema.optional(),
      getDocumentation:
        searchDocsOutputSchema.shape.results.element.shape.getDocumentation,
    }),
  ),
  coverage: searchDocsOutputSchema.shape.coverage
    .omit({ indexedSections: true })
    .extend({ indexedExamples: z.number().int().nonnegative() }),
});

export type TGetCodeExamplesInput = z.input<typeof getCodeExamplesInputSchema>;
export type TGetCodeExamplesResult = z.infer<
  typeof getCodeExamplesOutputSchema
>;
