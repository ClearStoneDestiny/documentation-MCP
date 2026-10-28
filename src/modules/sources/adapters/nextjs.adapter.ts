import { Inject, Injectable } from "@nestjs/common";
import type { ISourceAdapter } from "../interfaces/source-adapter.interface.js";
import type { ISourceDocument } from "../interfaces/source-document.interface.js";
import type { ISourceCatalog } from "../interfaces/source-catalog.interface.js";
import type { ISourceFetchOptions } from "../interfaces/source-fetch-options.interface.js";
import { CachedMarkdownService } from "../services/cached-markdown.service.js";
import { parseNextjsCatalog } from "../parsers/nextjs-catalog.parser.js";
import { LIBRARY_SOURCE_OPTIONS } from "../constants/library-source-options.constant.js";
import type { ILibrarySourceOptions } from "../interfaces/library-source-options.interface.js";
import { NEXTJS_DOCUMENT_PATH_PATTERN } from "../constants/nextjs.constant.js";

@Injectable()
export class NextjsAdapter implements ISourceAdapter {
  readonly libraryId: string;
  readonly documentationUrl: string;
  private readonly catalogUrl: string;

  constructor(
    @Inject(CachedMarkdownService)
    private readonly markdown: CachedMarkdownService,
    @Inject(LIBRARY_SOURCE_OPTIONS)
    source: ILibrarySourceOptions,
  ) {
    if (source.sources.catalog?.format !== "llms-txt") {
      throw new Error("NextjsAdapter requires an llms-txt catalog source.");
    }
    
    this.libraryId = source.id;
    this.documentationUrl = source.documentationUrl;
    this.catalogUrl = source.sources.catalog.url;
  }

  async fetchCatalog(
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceCatalog> {
    const response = await this.markdown.load(
      this.catalogUrl,
      signal,
      options,
    );
    return {
      libraryId: this.libraryId,
      sourceUrl: this.catalogUrl,
      fetchedAt: response.fetchedAt,
      cache: response.cache,
      ...parseNextjsCatalog(response.content, this.documentationUrl),
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

    const sourceUrl = new URL(path, this.documentationUrl).href;
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
