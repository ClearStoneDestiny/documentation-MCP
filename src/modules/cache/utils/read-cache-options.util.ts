import { homedir } from "node:os";
import { join } from "node:path";
import { ICacheOptions } from "../interfaces/cache-options.interface.js";

export function readCacheOptions(): ICacheOptions {
  return {
    directory:
      process.env.DOCUMENTATION_MCP_CACHE_DIR ??
      join(homedir(), ".cache", "documentation-mcp"),
    ttlMs: Number(process.env.DOCUMENTATION_MCP_CACHE_TTL_MS ?? 3_600_000),
    enabled: process.env.DOCUMENTATION_MCP_CACHE_ENABLED !== "false",
  };
}
