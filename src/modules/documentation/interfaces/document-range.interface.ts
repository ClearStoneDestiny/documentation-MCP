export interface IDocumentRange {
  // One-based source line numbers, inclusive
  startLine: number;
  endLine: number;
  // JavaScript string offsets: start inclusive, end exclusive
  startOffset: number;
  endOffset: number;
}
