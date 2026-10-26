import { Injectable } from "@nestjs/common";
import { ISourceAdapter } from "../interfaces/source-adapter.interface.js";
import { ISourceDocument } from "../interfaces/source-document.interface.js";

const DOCS_BASE_URL = "https://nextjs.org/docs/";
const REQUEST_TIMEOUT_MS = 10_000;

@Injectable()
export class NextjsAdapter implements ISourceAdapter {
  readonly libraryId = "nextjs";

  async fetchDocument(
    path: string,
    signal?: AbortSignal,
  ): Promise<ISourceDocument> {
    // Paths are relative to /docs, for example app/getting-started/caching
    if (!/^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(path)) {
      throw new Error(`Invalid Next.js documentation path: ${path}`);
    }

    const sourceUrl = new URL(path, DOCS_BASE_URL).href;
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const response = await fetch(`${sourceUrl}.md`, {
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

    return {
      libraryId: this.libraryId,
      path,
      sourceUrl,
      content,
      format: "markdown",
      fetchedAt: new Date().toISOString(),
    };
  }
}
