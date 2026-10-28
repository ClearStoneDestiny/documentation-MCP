import { Inject, Injectable } from "@nestjs/common";
import { NextjsAdapter } from "../sources/adapters/nextjs.adapter.js";
import {
  listVersionsInputSchema,
  TListVersionsInput,
  TListVersionsResult,
} from "./schemas/list-versions.schema.js";
import { DocumentationError } from "../documentation/errors/documentation.error.js";
import { ISourceCatalog } from "../sources/interfaces/source-catalog.interface.js";
import { NEXTJS_DOCS_BASE_URL } from "../sources/constants/nextjs.constant.js";

@Injectable()
export class VersionService {
  constructor(@Inject(NextjsAdapter) private readonly nextjs: NextjsAdapter) {}

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

    let catalog: ISourceCatalog;

    try {
      catalog = await this.nextjs.fetchCatalog(signal, {
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
          label: "Current Next.js documentation",
          channel: "current",
          declaredVersion: catalog.docVersion ?? null,
          versionRange: null,
          sourceUrl: NEXTJS_DOCS_BASE_URL,
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
