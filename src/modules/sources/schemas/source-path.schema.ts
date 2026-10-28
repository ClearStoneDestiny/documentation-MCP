import * as z from "zod/v4";

export const sourcePathSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(
    /^[^/\\:%?#\s\u0000-\u001f\u007f]+(?:\/[^/\\:%?#\s\u0000-\u001f\u007f]+)*$/u,
  )
  .refine(
    (path) => path.split("/").every((part) => part !== "." && part !== ".."),
    "Use a relative source path without dot segments.",
  )
  .describe(
    "Relative path within the selected library's documentation. Use paths returned by search_docs; source-specific rules apply.",
  );
