import * as z from "zod/v4";
import { cacheInfoSchema } from "../../cache/schemas/cache.schema.js";
import { CURRENT_DOCUMENTATION_SET_ID } from "../../libraries/constants/documentation-set.constant.js";
import { documentationSetSchema } from "../../libraries/schemas/documentation-set.schema.js";

export const sourceDocumentationSetsSchema = z.object({
  documentationSets: z
    .array(documentationSetSchema)
    .refine(
      (sets) => new Set(sets.map((set) => set.id)).size === sets.length,
      "Documentation set IDs must be unique.",
    )
    .refine(
      (sets) =>
        sets.every(
          (set) =>
            set.id === CURRENT_DOCUMENTATION_SET_ID &&
            set.channel === "current",
        ),
      "Only the current documentation set can be retrieved by the installed operations.",
    ),
  catalog: z
    .object({
      sourceUrl: z.string().url(),
      fetchedAt: z.string(),
      cache: cacheInfoSchema.optional(),
    })
    .optional(),
});
