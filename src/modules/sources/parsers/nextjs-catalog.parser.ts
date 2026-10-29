import {
  NEXTJS_DOCS_BASE_URL,
  NEXTJS_DOCUMENT_PATH_PATTERN,
} from "../constants/nextjs.constant.js";
import { parseLlmsCatalog } from "./llms-catalog.parser.js";

// Keep the Next.js parser entry point for existing callers
export function parseNextjsCatalog(
  content: string,
  documentationUrl = NEXTJS_DOCS_BASE_URL,
) {
  return parseLlmsCatalog(content, {
    documentationUrl,
    isValidPath: (path) => NEXTJS_DOCUMENT_PATH_PATTERN.test(path),
    sourceName: "Next.js",
  });
}
