import { TDocumentationErrorCode } from "../interfaces/documentation-error-code.type.js";

export class DocumentationError extends Error {
  constructor(
    readonly code: TDocumentationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentationError";
  }
}
