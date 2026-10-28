import * as z from "zod/v4";
import { libraryIdSchema } from "./library-id.schema.js";
import { sourceDocumentationSetsSchema } from "../../sources/schemas/source-documentation-sets.schema.js";

export const listVersionsInputSchema = z.strictObject({
  library: libraryIdSchema,
  refresh: z.boolean().default(false),
});

export const listVersionsOutputSchema = z.object({
  library: libraryIdSchema,
  ...sourceDocumentationSetsSchema.shape,
});

export type TListVersionsInput = z.input<typeof listVersionsInputSchema>;
export type TListVersionsResult = z.infer<typeof listVersionsOutputSchema>;
