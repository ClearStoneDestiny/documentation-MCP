import * as z from "zod/v4";

export const documentationSetSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "Documentation set identifier, independent of package version numbers.",
    ),
  label: z.string().min(1),
  channel: z.enum(["current", "versioned"]),
  declaredVersion: z.union([
    z
      .string()
      .describe(
        "Version declared by the documentation source. This is not necessarily an immutable documentation revision or a verified compatibility range.",
      ),
    z
      .null()
      .describe("The source does not declare a version, or it is unavailable."),
  ]),
  versionRange: z.union([
    z
      .string()
      .describe(
        "Compatibility range, when independently verified and available.",
      ),
    z.null().describe("No verified compatibility range is available."),
  ]),
  sourceUrl: z.string().url(),
});
