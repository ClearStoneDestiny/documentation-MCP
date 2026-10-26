# Documentation MCP

A local, stdio-based MCP server for official, version-aware library and framework documentation.

The project currently contains Nest.js standalone, the official MCP TypeScript SDK v2, a `get_server_info` tool for checking connectivity, and a Next.js source adapter. The adapter loads a single current documentation page as raw Markdown; it is not exposed through MCP tools yet. Documentation parsing, search, caching, version selection, resources, and prompts are planned but not implemented yet.

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
    sources/
      source-adapter.ts # Source contract and raw document model
      sources.module.ts # Source adapter providers
      adapters/
        nextjs.adapter.ts # Fetch a Next.js documentation page as Markdown
test/
  stdio.unit.spec.mjs          # Process-level protocol checks
  nextjs-adapter.unit.spec.mjs # Source adapter checks with mocked HTTP
```

The Next.js adapter accepts a path relative to `/docs`, for example `app/getting-started/caching`. It fetches the official `.md` URL with a 10-second timeout and supports caller cancellation. Returned documents retain the original Markdown, canonical page URL, and fetch time. Current documentation URLs are mutable; `fetchedAt` is a retrieval timestamp, not a framework version or immutable source revision. Unit tests use mocked HTTP responses and do not need network access.

Runtime dependencies are Nest.js, MCP Server SDK, Zod, reflect-metadata, and RxJS. TypeScript, tsx, Vitest, Node.js types, MCP Client SDK, and MCP Inspector are development dependencies. Exact versions are recorded in `package.json` and `package-lock.json`.

The npm package is private while the initial implementation and release setup are being prepared.
