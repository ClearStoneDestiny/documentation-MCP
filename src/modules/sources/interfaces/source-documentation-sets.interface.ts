import type { IDocumentationSet } from "../../libraries/interfaces/documentation-set.interface.js";
import type { ISourceCatalog } from "./source-catalog.interface.js";

export interface ISourceDocumentationSets {
  readonly documentationSets: readonly IDocumentationSet[];
  // Optional provenance when discovery actually reads a documentation catalog
  readonly catalog?: Pick<ISourceCatalog, "sourceUrl" | "fetchedAt" | "cache">;
}
