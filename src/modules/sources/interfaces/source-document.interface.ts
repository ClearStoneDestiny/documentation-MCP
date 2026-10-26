// Raw source material, before Markdown parsing or indexing
export interface ISourceDocument {
  libraryId: string;
  path: string;
  sourceUrl: string;
  content: string;
  format: "markdown";
  fetchedAt: string;
}
