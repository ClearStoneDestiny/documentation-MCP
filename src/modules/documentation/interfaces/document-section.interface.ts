import type { ICodeExample } from "./code-example.interface.js";
import type { IDocumentRange } from "./document-range.interface.js";

export interface IDocumentSection {
  // Internal document-local ID; not a verified anchor on the source website
  id: string;
  title: string;
  // Heading depth 1–6; 0 represents content before the first heading
  depth: number;
  parentId?: string;
  headingPath: string[];
  // Heading and following content, ending before the next heading
  content: string;
  range: IDocumentRange;
  codeExamples: ICodeExample[];
}
