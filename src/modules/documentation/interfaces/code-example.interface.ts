import type { IDocumentRange } from "./document-range.interface.js";

export interface ICodeExample {
  id: string;
  code: string;
  language?: string;
  // Original fence parameters, for example title="page.tsx" highlight={1}
  meta?: string;
  // Verbatim source excerpt, including fences or indentation
  markdown: string;
  range: IDocumentRange;
}
