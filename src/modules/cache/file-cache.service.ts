import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Inject, Injectable } from "@nestjs/common";
import { cacheEntrySchema, type TCacheEntry } from "./schemas/cache.schema.js";
import { ICacheOptions } from "./interfaces/cache-options.interface.js";
import { CACHE_OPTIONS } from "./constants/cache-options.constant.js";
import { contentHash } from "./utils/content-hash.util.js";

@Injectable()
export class FileCacheService {
  readonly options: ICacheOptions;

  constructor(@Inject(CACHE_OPTIONS) options: ICacheOptions) {
    if (
      !options.directory.trim() ||
      !Number.isSafeInteger(options.ttlMs) ||
      options.ttlMs < 0
    ) {
      throw new Error(
        "Invalid cache configuration: provide a directory and a nonnegative integer TTL in milliseconds.",
      );
    }
    this.options = { ...options, directory: resolve(options.directory) };
  }

  private entryPath(url: string): string {
    return join(this.options.directory, "v1", `${contentHash(url)}.json`);
  }

  async read(url: string): Promise<TCacheEntry | null> {
    if (!this.options.enabled) {
      return null;
    }

    try {
      const entry = cacheEntrySchema.parse(
        JSON.parse(await readFile(this.entryPath(url), "utf8")),
      );

      if (
        entry.url !== url ||
        entry.contentHash !== contentHash(entry.content)
      ) {
        throw new Error("Cache identity or content hash mismatch");
      }

      return entry;
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      ) {
        console.error(
          "[cache] Ignoring unreadable or invalid cache entry:",
          error,
        );
      }

      return null;
    }
  }

  async write(entry: TCacheEntry): Promise<boolean> {
    if (!this.options.enabled) {
      return false;
    }

    const target = this.entryPath(entry.url);
    const temporary = `${target}.${randomUUID()}.tmp`;

    try {
      await mkdir(join(this.options.directory, "v1"), {
        recursive: true,
        mode: 0o700,
      });

      await writeFile(temporary, JSON.stringify(entry), {
        flag: "wx",
        mode: 0o600,
      });

      await rename(temporary, target);

      return true;
    } catch (error) {
      console.error("[cache] Could not persist entry:", error);
      return false;
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async remove(url: string): Promise<void> {
    if (!this.options.enabled) {
      return;
    }

    await rm(this.entryPath(url), { force: true }).catch((error: unknown) => {
      console.error("[cache] Could not remove entry:", error);
    });
  }
}
