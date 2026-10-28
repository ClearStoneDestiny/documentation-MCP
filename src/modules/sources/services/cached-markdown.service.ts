import { Inject, Injectable } from "@nestjs/common";
import { FileCacheService } from "../../cache/file-cache.service.js";
import type {
  TCacheEntry,
  TCacheInfo,
} from "../../cache/schemas/cache.schema.js";
import type { ISourceFetchOptions } from "../interfaces/source-fetch-options.interface.js";
import { contentHash } from "../../cache/utils/content-hash.util.js";

class SourceHttpError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
  ) {
    super(message);
  }
}

interface IMarkdownResponse {
  content: string;
  fetchedAt: string;
  cache: TCacheInfo;
}

@Injectable()
export class CachedMarkdownService {
  constructor(
    @Inject(FileCacheService) private readonly store: FileCacheService,
  ) {}

  async load(
    url: string,
    signal?: AbortSignal,
    options: ISourceFetchOptions = {},
  ): Promise<IMarkdownResponse> {
    signal?.throwIfAborted();

    const cached = await this.store.read(url);

    signal?.throwIfAborted();

    const age = cached ? Date.now() - Date.parse(cached.checkedAt) : Infinity;

    if (
      cached &&
      !options.refresh &&
      age >= 0 &&
      age < this.store.options.ttlMs
    ) {
      return this.result(cached, "hit", true);
    }

    const timeout = AbortSignal.timeout(10_000);
    const headers = new Headers({ Accept: "text/markdown" });

    if (cached?.etag) {
      headers.set("If-None-Match", cached.etag);
    } else if (cached?.lastModified) {
      headers.set("If-Modified-Since", cached.lastModified);
    }

    try {
      const response = await fetch(url, {
        headers,
        redirect: "manual",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });

      signal?.throwIfAborted();

      const now = new Date().toISOString();

      if (response.status === 304) {
        if (!cached)
          throw new SourceHttpError(
            `Unexpected HTTP 304 without cached documentation: ${url}`,
            false,
          );

        const entry: TCacheEntry = {
          ...cached,
          checkedAt: now,
          etag: response.headers.get("etag") ?? cached.etag,
          lastModified:
            response.headers.get("last-modified") ?? cached.lastModified,
        };

        if (
          response.headers
            .get("cache-control")
            ?.toLowerCase()
            .includes("no-store")
        ) {
          await this.store.remove(url);
          return this.result(entry, "disabled", false);
        }
        return this.save(entry, "revalidated");
      }

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          await this.store.remove(url);
        }

        throw new SourceHttpError(
          `Failed to fetch documentation (${response.status}): ${url}`,
          response.status === 408 ||
            response.status === 429 ||
            response.status >= 500,
        );
      }

      const contentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();

      if (contentType !== "text/markdown" && contentType !== "text/plain") {
        throw new SourceHttpError(
          `Expected Markdown, received ${contentType ?? "no content type"}: ${url}`,
          false,
        );
      }

      const content = await response.text();

      signal?.throwIfAborted();

      if (!content.trim()) {
        throw new SourceHttpError(`Empty documentation: ${url}`, false);
      }

      const entry: TCacheEntry = {
        schemaVersion: 1,
        url,
        content,
        contentHash: contentHash(content),
        fetchedAt: now,
        checkedAt: now,
        ...(response.headers.get("etag")
          ? { etag: response.headers.get("etag")! }
          : {}),
        ...(response.headers.get("last-modified")
          ? { lastModified: response.headers.get("last-modified")! }
          : {}),
      };

      if (
        response.headers
          .get("cache-control")
          ?.toLowerCase()
          .includes("no-store")
      ) {
        await this.store.remove(url);
        return this.result(entry, "disabled", false);
      }
      return this.save(
        entry,
        !cached
          ? "miss"
          : cached.contentHash === entry.contentHash
            ? "revalidated"
            : "updated",
      );
    } catch (error) {
      signal?.throwIfAborted();

      const isTimeoutError =
        timeout.aborted ||
        (error instanceof Error && error.name === "TimeoutError");

      const isTransientError =
        error instanceof SourceHttpError
          ? error.transient
          : isTimeoutError || error instanceof TypeError;

      if (cached && isTransientError) {
        return this.result(
          cached,
          "stale",
          true,
          `Source check failed; serving the saved copy. ${error instanceof Error ? error.message : "Request failed"}`,
        );
      }
      throw error;
    }
  }

  private async save(
    entry: TCacheEntry,
    status: TCacheInfo["status"],
  ): Promise<IMarkdownResponse> {
    if (!this.store.options.enabled) {
      return this.result(entry, "disabled", false);
    }

    const persisted = await this.store.write(entry);
    return this.result(
      entry,
      status,
      persisted,
      persisted ? undefined : "Could not save documentation to disk.",
    );
  }

  private result(
    entry: TCacheEntry,
    status: TCacheInfo["status"],
    persisted: boolean,
    warning?: string,
  ): IMarkdownResponse {
    return {
      content: entry.content,
      fetchedAt: entry.fetchedAt,
      cache: {
        status,
        checkedAt: entry.checkedAt,
        persisted,
        ...(warning ? { warning } : {}),
      },
    };
  }
}
