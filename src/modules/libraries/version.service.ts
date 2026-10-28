import { Inject, Injectable } from "@nestjs/common";
import { LibraryRegistry } from "./library-registry.service.js";
import {
  listVersionsInputSchema,
  TListVersionsInput,
  TListVersionsResult,
} from "./schemas/list-versions.schema.js";
import { DocumentationError } from "../documentation/errors/documentation.error.js";
import { ISourceCatalog } from "../sources/interfaces/source-catalog.interface.js";

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

    let catalog: ISourceCatalog;

    try {
      catalog = await registration.adapter.fetchCatalog(signal, {
        refresh: request.refresh,
      });
    } catch (cause: any) {
      signal?.throwIfAborted();

      const message = cause instanceof Error ? cause.message : "Request failed";

      throw new DocumentationError("SOURCE_ERROR", message, { cause });
    }

    signal?.throwIfAborted();

    return {
      library: request.library,

      documentationSets: [
        {
          id: "current",
          label: `Current ${registration.name} documentation`,
          channel: "current",
          declaredVersion: catalog.docVersion ?? null,
          versionRange: null,
          sourceUrl: registration.documentationUrl,
        },
      ],

      catalog: {
        sourceUrl: catalog.sourceUrl,
        fetchedAt: catalog.fetchedAt,
        ...(catalog.cache ? { cache: catalog.cache } : {}),
      },
    };
  }
}
