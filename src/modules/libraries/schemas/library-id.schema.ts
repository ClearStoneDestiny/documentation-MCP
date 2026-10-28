import * as z from "zod/v4";
import { LIBRARY_ID_PATTERN } from "../constants/library.constant.js";

// Registry lookup determines availability; the schema only validates syntax
export const libraryIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(LIBRARY_ID_PATTERN)
  .describe("Library identifier from list_libraries.");
