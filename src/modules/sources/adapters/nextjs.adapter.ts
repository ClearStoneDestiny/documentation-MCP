import { Injectable } from "@nestjs/common";
import type { ISourceAdapter } from "../interfaces/source-adapter.interface.js";
import type { ISourceDocument } from "../interfaces/source-document.interface.js";
import type { ISourceCatalog } from "../interfaces/source-catalog.interface.js";
import { parseNextjsCatalog } from "../parsers/nextjs-catalog.parser.js";
import {
  NEXTJS_CATALOG_URL,
  NEXTJS_DOCS_BASE_URL,
  NEXTJS_DOCUMENT_PATH_PATTERN,
} from "../constants/nextjs.constant.js";

const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class NextjsAdapter implements ISourceAdapter {
  readonly libraryId = "nextjs";

  async fetchCatalog(signal?: AbortSignal): Promise<ISourceCatalog> {
    const content = await this.fetchMarkdown(NEXTJS_CATALOG_URL, signal);
    return {
      libraryId: this.libraryId,
      sourceUrl: NEXTJS_CATALOG_URL,
      fetchedAt: new Date().toISOString(),
      ...parseNextjsCatalog(content),
    };
  }

  async fetchDocument(
    path: string,
    signal?: AbortSignal,
  ): Promise<ISourceDocument> {
    // Paths are relative to /docs, for example app/getting-started/caching
    if (!NEXTJS_DOCUMENT_PATH_PATTERN.test(path)) {
      throw new Error(`Invalid Next.js documentation path: ${path}`);
    }

    const sourceUrl = new URL(path, NEXTJS_DOCS_BASE_URL).href;
    const content = await this.fetchMarkdown(`${sourceUrl}.md`, signal);

    return {
      libraryId: this.libraryId,
      path,
      sourceUrl,
      content,
      format: "markdown",
      fetchedAt: new Date().toISOString(),
    };
  }

  private async fetchMarkdown(
    sourceUrl: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(sourceUrl, {
      headers: { Accept: "text/markdown" },
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch Next.js documentation (${response.status}): ${sourceUrl}`,
      );
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();

    if (contentType !== "text/markdown" && contentType !== "text/plain") {
      throw new Error(
        `Expected Markdown from Next.js, received ${contentType ?? "no content type"}: ${sourceUrl}`,
      );
    }

    const content = await response.text();

    if (!content.trim()) {
      throw new Error(`Empty Next.js documentation: ${sourceUrl}`);
    }

    return content;
  }
}
