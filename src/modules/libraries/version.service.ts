import { Inject, Injectable } from "@nestjs/common";
import { LibraryRegistry } from "./library-registry.service.js";
import {
  listVersionsInputSchema,
  TListVersionsInput,
  TListVersionsResult,
} from "./schemas/list-versions.schema.js";
import { DocumentationError } from "../documentation/errors/documentation.error.js";
import { sourceDocumentationSetsSchema } from "../sources/schemas/source-documentation-sets.schema.js";
import type { ISourceDocumentationSets } from "../sources/interfaces/source-documentation-sets.interface.js";

@Injectable()
export class VersionService {
  constructor(
    @Inject(LibraryRegistry) private readonly registry: LibraryRegistry,
  ) {}

  async listVersion(
    input: TListVersionsInput,
    signal?: AbortSignal,
  ): Promise<TListVersionsResult> {
    const validation = listVersionsInputSchema.safeParse(input);

    if (!validation.success) {
      throw new DocumentationError("INVALID_REQUEST", validation.error.message);
    }

    const request = validation.data;

    signal?.throwIfAborted();

    const registration = this.registry.get(request.library);

    if (!registration) {
      throw new DocumentationError("INVALID_REQUEST", "Unsupported library.");
    }

    const operation = registration.operations.list_versions;

    if (!operation) {
      throw new DocumentationError(
        "TOOL_UNSUPPORTED",
        `list_versions is not supported for library ${registration.id}.`,
      );
    }

    let sets: ISourceDocumentationSets;

    try {
      sets = await operation.listDocumentationSets(signal, {
        refresh: request.refresh,
      });
    } catch (cause: unknown) {
      signal?.throwIfAborted();

      const message = cause instanceof Error ? cause.message : "Request failed";

      throw new DocumentationError("SOURCE_ERROR", message, { cause });
    }

    signal?.throwIfAborted();

    const result = sourceDocumentationSetsSchema.safeParse(sets);

    if (!result.success) {
      throw new DocumentationError(
        "SOURCE_ERROR",
        "Source returned invalid or unavailable documentation sets.",
        { cause: result.error },
      );
    }

    return {
      library: request.library,
      ...result.data,
    };
  }
}
