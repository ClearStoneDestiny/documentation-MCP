import type { IDocumentationScope } from "../../libraries/interfaces/documentation-scope.interface.js";

export interface ICacheKey extends IDocumentationScope {
  readonly url: string;
}
