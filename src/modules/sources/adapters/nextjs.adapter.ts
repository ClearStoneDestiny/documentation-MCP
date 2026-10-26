import { Inject, Injectable } from "@nestjs/common";
import type { ISourceAdapter } from "../interfaces/source-adapter.interface.js";
import type { ISourceDocument } from "../interfaces/source-document.interface.js";
import type { ISourceCatalog } from "../interfaces/source-catalog.interface.js";
import type { ISourceFetchOptions } from "../interfaces/source-fetch-options.interface.js";
import { CachedMarkdownService } from "../services/cached-markdown.service.js";
import { parseNextjsCatalog } from "../parsers/nextjs-catalog.parser.js";
import {
  NEXTJS_CATALOG_URL,
  NEXTJS_DOCS_BASE_URL,
  NEXTJS_DOCUMENT_PATH_PATTERN,
} from "../constants/nextjs.constant.js";

@Injectable()
export class NextjsAdapter implements ISourceAdapter {
  readonly libraryId = "nextjs";

  constructor(
    @Inject(CachedMarkdownService)
    private readonly markdown: CachedMarkdownService,
  ) {}

  async fetchCatalog(
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceCatalog> {
    const response = await this.markdown.load(
      NEXTJS_CATALOG_URL,
      signal,
      options,
    );
    return {
      libraryId: this.libraryId,
      sourceUrl: NEXTJS_CATALOG_URL,
      fetchedAt: response.fetchedAt,
      cache: response.cache,
      ...parseNextjsCatalog(response.content),
    };
  }

  async fetchDocument(
    path: string,
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceDocument> {
    // Paths are relative to /docs, for example app/getting-started/caching
    if (!NEXTJS_DOCUMENT_PATH_PATTERN.test(path)) {
      throw new Error(`Invalid Next.js documentation path: ${path}`);
    }

    const sourceUrl = new URL(path, NEXTJS_DOCS_BASE_URL).href;
    const response = await this.markdown.load(
      `${sourceUrl}.md`,
      signal,
      options,
    );

    return {
      libraryId: this.libraryId,
      path,
      sourceUrl,
      content: response.content,
      format: "markdown",
      fetchedAt: response.fetchedAt,
      cache: response.cache,
    };
  }
}
