// A retrievable documentation collection. Its ID is independent of package releases
export interface IDocumentationSet {
  readonly id: string;
  readonly label: string;
  readonly channel: "current" | "versioned";
  // Metadata declared by the source, not an immutable revision selector
  readonly declaredVersion: string | null;
  // Only an independently verified compatibility range may be provided
  readonly versionRange: string | null;
  readonly sourceUrl: string;
}
