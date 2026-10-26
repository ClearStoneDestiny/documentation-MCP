// A discoverable page, before its content has been fetched
export interface ISourceDocumentReference {
  path: string;
  title: string;
  sourceUrl: string;
  description?: string;
  section?: string;
}
