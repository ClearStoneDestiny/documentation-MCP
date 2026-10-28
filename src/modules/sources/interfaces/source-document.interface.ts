import type { TCacheInfo } from "../../cache/schemas/cache.schema.js";

// Raw source material, before Markdown parsing or indexing
export interface ISourceDocument {
  libraryId: string;
  path: string;
  sourceUrl: string;
  content: string;
  format: string;
  fetchedAt: string;
  cache?: TCacheInfo;
}
