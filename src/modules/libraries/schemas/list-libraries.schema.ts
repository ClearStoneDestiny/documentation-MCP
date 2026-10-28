import * as z from "zod/v4";
import { libraryIdSchema } from "./list-versions.schema.js";
import { LIBRARY_TOOL_NAMES } from "../constants/library.constant.js";

export const listLibrariesInputSchema = z.strictObject({
  filter: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Case-insensitive substring filter applied to library identifiers " +
        "and display names. Omit to list all supported libraries.",
    ),
});

const libraryToolSchema = z.enum(LIBRARY_TOOL_NAMES);

export const listLibrariesOutputSchema = z.object({
  libraries: z.array(
    z.object({
      id: libraryIdSchema,
      name: z.string().min(1),
      documentationUrl: z.string().url(),
      capabilities: z.object({
        tools: z.array(libraryToolSchema),
        historicalDocumentation: z.boolean(),
      }),
    }),
  ),
});

export type TListLibrariesInput = z.input<typeof listLibrariesInputSchema>;
export type TListLibrariesResult = z.infer<typeof listLibrariesOutputSchema>;
