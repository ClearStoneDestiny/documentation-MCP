import * as z from "zod/v4";
import { cacheInfoSchema } from "../../cache/schemas/cache.schema.js";
import { NEXTJS_DOCUMENT_PATH_PATTERN } from "../../sources/constants/nextjs.constant.js";
import { queryTerms } from "../utils/tokenize.util.js";

export const searchDocsInputSchema = z.strictObject({
  library: z.literal("nextjs"),
  query: z
    .string()
    .trim()
    .min(1)
    .max(256)
    .refine(
      (query) => queryTerms(query).length > 0,
      "Use at least one searchable keyword.",
    )
    .describe(
      "Lexical keywords in the documentation's language, usually English; include exact API names. No semantic translation or historical version comparison.",
    ),
  path_prefix: z
    .string()
    .min(1)
    .max(512)
    .regex(NEXTJS_DOCUMENT_PATH_PATTERN)
    .optional()
    .describe(
      "Optional exact page or subtree relative to /docs, e.g. app/guides. Restricts both downloads and search. No trailing slash.",
    ),
  limit: z.number().int().min(1).max(20).default(5),
  refresh: z
    .boolean()
    .default(false)
    .describe(
      "Recheck the catalog and every page in the selected scope now, bypassing cache TTL.",
    ),
});

export const searchDocsOutputSchema = z.object({
  libraryId: z.literal("nextjs"),
  channel: z.literal("current"),
  query: z.string(),
  terms: z.array(z.string()),
  totalMatches: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      path: z.string(),
      sourceUrl: z.string(),
      title: z.string(),
      sectionId: z.string(),
      sectionTitle: z.string(),
      headingPath: z.array(z.string()),
      startLine: z.number().int(),
      endLine: z.number().int(),
      snippet: z.string(),
      score: z.number().nonnegative(),
      matchedTerms: z.array(z.string()),
      contentHash: z.string(),
      fetchedAt: z.string(),
      cache: cacheInfoSchema.optional(),
      getDocumentation: z.object({
        library: z.literal("nextjs"),
        path: z.string(),
        section_id: z.string(),
        expected_hash: z.string(),
      }),
    }),
  ),
  coverage: z.object({
    catalogUrl: z.string(),
    catalogCache: cacheInfoSchema.optional(),
    docVersion: z.string().optional(),
    scope: z.literal("root-catalog"),
    pathPrefix: z.string().optional(),
    catalogDocuments: z.number().int().nonnegative(),
    selectedDocuments: z.number().int().nonnegative(),
    indexedDocuments: z.number().int().nonnegative(),
    indexedSections: z.number().int().nonnegative(),
    failedDocuments: z.number().int().nonnegative(),
    staleDocuments: z.number().int().nonnegative(),
    partial: z.boolean(),
    failures: z.array(
      z.object({
        path: z.string(),
        code: z.enum(["SOURCE_ERROR", "PARSE_ERROR"]),
      }),
    ),
    failuresTruncated: z.boolean(),
  }),
});

export type TSearchDocsInput = z.input<typeof searchDocsInputSchema>;
export type TSearchDocsResult = z.infer<typeof searchDocsOutputSchema>;
