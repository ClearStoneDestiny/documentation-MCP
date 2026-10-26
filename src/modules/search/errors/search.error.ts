export class SearchError extends Error {
  constructor(
    readonly code: "INVALID_REQUEST" | "SOURCE_ERROR" | "INDEX_UNAVAILABLE",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SearchError";
  }
}
