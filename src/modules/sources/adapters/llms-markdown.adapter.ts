import type { ISourceAdapter } from "../interfaces/source-adapter.interface.js";
import type { ISourceCatalog } from "../interfaces/source-catalog.interface.js";
import type { ISourceDocument } from "../interfaces/source-document.interface.js";
import type { ISourceDocumentationSets } from "../interfaces/source-documentation-sets.interface.js";
import type { ISourceFetchOptions } from "../interfaces/source-fetch-options.interface.js";
import type { ILibrarySourceOptions } from "../interfaces/library-source-options.interface.js";
import type { CachedMarkdownService } from "../services/cached-markdown.service.js";
import { CURRENT_DOCUMENTATION_SET_ID } from "../../libraries/constants/documentation-set.constant.js";
import { parseLlmsCatalog } from "../parsers/llms-catalog.parser.js";

// Sources using a link-list catalog and extensionless canonical URLs with .md bodies
export abstract class LlmsMarkdownAdapter implements ISourceAdapter {
  readonly documentFormat = "markdown";
  readonly libraryId: string;
  readonly documentationUrl: string;
  private readonly catalogUrl: string;
  private readonly name: string;

  constructor(
    private readonly markdown: CachedMarkdownService,
    source: ILibrarySourceOptions,
  ) {
    if (source.sources.catalog?.format !== "llms-txt") {
      throw new Error(
        `${this.constructor.name} requires an llms-txt catalog source.`,
      );
    }

    this.libraryId = source.id;
    this.documentationUrl = source.documentationUrl;
    this.catalogUrl = source.sources.catalog.url;
    this.name = source.name;
  }

  abstract isValidPath(path: string): boolean;

  async listDocumentationSets(
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceDocumentationSets> {
    const catalog = await this.fetchCatalog(signal, options);

    signal?.throwIfAborted();

    return {
      documentationSets: [
        {
          id: CURRENT_DOCUMENTATION_SET_ID,
          label: `Current ${this.name} documentation`,
          channel: "current",
          declaredVersion: catalog.docVersion ?? null,
          versionRange: null,
          sourceUrl: this.documentationUrl,
        },
      ],
      
      catalog: {
        sourceUrl: catalog.sourceUrl,
        fetchedAt: catalog.fetchedAt,
        ...(catalog.cache ? { cache: catalog.cache } : {}),
      },
    };
  }

  async fetchCatalog(
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceCatalog> {
    const response = await this.markdown.load(this.catalogUrl, signal, options);

    return {
      libraryId: this.libraryId,
      sourceUrl: this.catalogUrl,
      fetchedAt: response.fetchedAt,
      cache: response.cache,
      ...parseLlmsCatalog(response.content, {
        documentationUrl: this.documentationUrl,
        isValidPath: (path) => this.isValidPath(path),
        sourceName: this.name,
      }),
    };
  }

  async fetchDocument(
    path: string,
    signal?: AbortSignal,
    options?: ISourceFetchOptions,
  ): Promise<ISourceDocument> {
    if (!this.isValidPath(path)) {
      throw new Error(`Invalid ${this.name} documentation path: ${path}`);
    }

    const sourceUrl = new URL(path, this.documentationUrl).href;
    const response = await this.markdown.load(`${sourceUrl}.md`, signal, options);

    return {
      libraryId: this.libraryId,
      path,
      sourceUrl,
      content: response.content,
      format: this.documentFormat,
      fetchedAt: response.fetchedAt,
      cache: response.cache,
    };
  }
}
