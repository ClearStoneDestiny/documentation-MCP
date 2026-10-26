# Documentation MCP

A local, stdio-based MCP server for official, version-aware library and framework documentation.

The project currently contains Nest.js standalone, the official MCP TypeScript SDK v2, a `get_server_info` tool for checking connectivity, and a Next.js source adapter. The adapter discovers documentation pages through the official `llms.txt` catalog and loads individual pages as raw Markdown. The adapter is not exposed through MCP tools yet. Document content parsing, search, caching, version selection, resources, and prompts are planned but not implemented yet.

## Requirements

- Node.js 22.19.0 or newer
- npm

## Development

```sh
npm ci
npm run build
npm start
```

The server waits for MCP messages on stdin. It does not start an HTTP listener. Server logs go to stderr; stdout is reserved for MCP JSON-RPC messages.

```sh
npm run dev        # Run TypeScript with automatic restart
npm run typecheck  # Check TypeScript types
npm test          # Build and run adapter and stdio tests with Vitest
npm run inspector # Build and open MCP Inspector
```

Use explicit `@Inject(...)` tokens for future constructor dependencies: the `tsx` development runner does not emit decorator type metadata.

## Connect an MCP client

Build first, then configure a client that supports this JSON configuration shape:

```json
{
  "mcpServers": {
    "documentation": {
      "command": "node",
      "args": ["/absolute/path/to/documentation-MCP/dist/main.js"]
    }
  }
}
```

Replace the path with your local checkout. Launch `node` directly for MCP connections so npm script banners do not enter stdout. The SDK stdio entry point supports both current protocol discovery and legacy initialization.

## Structure

```text
src/
  main.ts             # Standalone bootstrap, stderr logging, shutdown
  app.module.ts       # Root Nest module
  modules/
    mcp/
      mcp.module.ts     # MCP providers
      mcp.service.ts    # Server factory and stdio lifecycle
      tests/
        stdio.unit.spec.mjs # Process-level protocol checks
    sources/
      sources.module.ts # Source adapter providers
      interfaces/       # Adapter, catalog, page reference, and raw document contracts
      adapters/
        nextjs.adapter.ts # Fetch the Next.js catalog and individual Markdown pages
        nextjs.constants.ts # Shared source URLs and supported path format
      parsers/
        nextjs-catalog.parser.ts # Parse the Next.js llms.txt link list
      tests/            # Adapter and catalog parser tests with local fixtures
```

The Next.js adapter accepts a path relative to `/docs`, for example `app/getting-started/caching`. It fetches the official `.md` URL with a 10-second timeout and supports caller cancellation. Returned documents retain the original Markdown, canonical page URL, and fetch time. Current documentation URLs are mutable; `fetchedAt` is a retrieval timestamp, not a framework version or immutable source revision. Unit tests use mocked HTTP responses and do not need network access.

## Next.js catalog

`NextjsAdapter.fetchCatalog(signal?)` makes one request to `https://nextjs.org/docs/llms.txt`. Each catalog entry contains a `path` accepted by `fetchDocument`, a `title`, a canonical `sourceUrl`, and optional `description` and `section` fields. The catalog also records `libraryId`, its own `sourceUrl`, `fetchedAt`, and `docVersion` when declared by the source index.

The parser handles linked section headings and nested list entries, normalizes `.md` URLs, trailing slashes, and fragments, and keeps the first entry for each unique document path. API path case and underscores are preserved, including names such as `cacheLife` and `unstable_cache`. External links, URLs outside `/docs/`, query URLs, unsupported paths, and fenced code examples are excluded. A catalog without usable document entries raises an error. `docVersion` is metadata reported by a mutable index; it does not pin subsequent page requests to that version.

After building, the adapter can be used directly:

```js
import { NextjsAdapter } from "./dist/modules/sources/adapters/nextjs.adapter.js";

const adapter = new NextjsAdapter();
const catalog = await adapter.fetchCatalog();
const page = catalog.documents.find((entry) => entry.path === "app/getting-started/caching");

if (page) {
  const document = await adapter.fetchDocument(page.path);
  console.log(document.content);
}
```

Fetching the catalog does not download document contents. Source adapters perform network requests only when called, so application startup remains local.

Discovery currently covers pages directly listed by the root index. Links to sub-indexes such as `/docs/pages/llms.txt` are excluded from document entries; recursive catalog discovery is a separate follow-up.

Runtime dependencies are Nest.js, MCP Server SDK, Zod, reflect-metadata, and RxJS. TypeScript, tsx, Vitest, Node.js types, MCP Client SDK, and MCP Inspector are development dependencies. Exact versions are recorded in `package.json` and `package-lock.json`.

The npm package is private while the initial implementation and release setup are being prepared.
