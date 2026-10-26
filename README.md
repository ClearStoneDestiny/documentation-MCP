# Documentation MCP

A local, stdio-based MCP server for official, version-aware library and framework documentation.

The project currently exposes `get_server_info` and `get_documentation` over stdio using Nest.js standalone and the official MCP TypeScript SDK v2. Documentation retrieval combines a Next.js source adapter, a persistent disk cache with update checks, and a Markdown parser. It returns current official pages or selected sections with freshness metadata. Search, version selection, resources, and prompts are planned but not implemented yet.

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
npm test          # Build and run cache, parser, adapter, and MCP tests with Vitest
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
    cache/
      cache.module.ts          # Cache configuration and disk storage provider
      cache.config.ts          # Cache directory, TTL, and enabled flag
      file-cache.service.ts    # Validated reads and atomic JSON writes
      schemas/                 # Versioned storage records and response metadata
      tests/                   # Disk persistence and corruption checks
    documentation/
      documentation.module.ts # Imports sources and exports documentation providers
      documentation.service.ts # Fetch, parse, select, and paginate documentation
      schemas/                 # Shared get_documentation input/output contracts
      errors/                  # Recoverable documentation errors
      interfaces/              # Parsed document, sections, examples, and source ranges
      parsers/
        markdown-document.parser.ts # CommonMark and YAML frontmatter parsing
      tests/                   # Parser checks and a local Markdown fixture
    mcp/
      mcp.module.ts     # MCP providers
      mcp.service.ts    # Server factory and stdio lifecycle
      tools/
        get-documentation.tool.ts # MCP registration and result/error mapping
      tests/
        stdio.unit.spec.mjs # Process-level protocol checks
    sources/
      sources.module.ts # Source adapter providers
      interfaces/       # Adapter, catalog, page reference, and raw document contracts
      adapters/
        nextjs.adapter.ts # Fetch the Next.js catalog and individual Markdown pages
      constants/
        nextjs.constant.ts # Shared source URLs and supported path format
      services/
        cached-markdown.service.ts # TTL, conditional HTTP, and stale fallback
      parsers/
        nextjs-catalog.parser.ts # Parse the Next.js llms.txt link list
      tests/            # Adapter and catalog parser tests with local fixtures
```

The Next.js adapter accepts a path relative to `/docs`, for example `app/getting-started/caching`. It loads the official `.md` URL through the disk cache; network requests have a 10-second timeout and support caller cancellation. Returned documents retain the original Markdown, canonical page URL, original download time, and cache metadata. Current documentation URLs are mutable; `fetchedAt` is a retrieval timestamp, not a framework version or immutable source revision. Unit tests use mocked HTTP responses and temporary directories, without accessing the user's default cache.

## get_documentation

Example tool arguments:

```json
{
  "library": "nextjs",
  "path": "app/getting-started/caching",
  "section_id": "usage",
  "max_chars": 12000
}
```

| Parameter | Meaning |
| --- | --- |
| `library` | Required; currently only `nextjs` is supported. |
| `path` | Required; page path relative to `/docs`, without a URL or `.md` suffix. |
| `section_id` | Optional ID from the response's `sections` outline. Returns the section and all its subsections. The synthetic Introduction returns only its own preamble. |
| `max_chars` | Markdown size limit, from 256 to 40,000; defaults to 12,000. Metadata and the section outline are additional. |
| `offset` | Offset within the selected content; defaults to 0. Continue with the returned `pagination.nextOffset`. |
| `expected_hash` | Previous `contentHash`; required for nonzero offsets. A source change returns `DOCUMENT_CHANGED` rather than mixing revisions. |
| `refresh` | Optional boolean, defaults to `false`. Check the source now even if the saved copy is still within its TTL. |

The response contains source metadata, document title and optional description/update date, `channel: "current"`, a SHA-256 `contentHash`, a compact document-wide section outline, selected Markdown in `content`, pagination information, and `cache` metadata. Omit `section_id` to read the whole source document, including frontmatter, and discover section IDs. Section IDs are internal selectors, not verified website anchors. Historical version arguments and other unknown parameters are rejected.

If `pagination.truncated` is true, repeat the call with the same `library`, `path`, and `section_id`, set `offset` to `pagination.nextOffset`, and set `expected_hash` to `contentHash`. Concatenating the content pages reconstructs the selection. Offsets and limits use JavaScript string units; surrogate pairs are kept intact. A response can end inside a code fence, so reassemble content before treating examples as complete. Continuations normally reuse the disk entry while it is fresh. A refresh or expired TTL may replace it; the content hash still detects changes rather than mixing revisions. The cache stores the latest saved copy, not a history of snapshots.

Operational failures return MCP `isError: true` with a JSON text block containing `code` and `message`. Codes include `SOURCE_ERROR`, `PARSE_ERROR`, `SECTION_NOT_FOUND`, `DOCUMENT_CHANGED`, and `INVALID_REQUEST`. SDK input-validation failures also return `isError: true`, with the SDK's validation message. The service honors request cancellation and the source adapter's timeout. The tool is read-only and accesses the network.

After building, test the tool with the locally installed Inspector:

```sh
node_modules/.bin/mcp-inspector --cli node dist/main.js \
  --method tools/call --tool-name get_documentation \
  --tool-arg library=nextjs \
  --tool-arg path=app/getting-started/caching \
  --tool-arg section_id=usage
```

`get_server_info` reports `stage: "documentation"`. Module dependencies are `McpModule → DocumentationModule → SourcesModule → CacheModule`; startup does not fetch documentation or create cache files. Automated tests exercise the cache, service, MCP SDK tool calls with mocked HTTP, and stdio discovery with both legacy and current protocol clients.

## Disk cache and update checks

Pages and `llms.txt` catalogs share the cache policy:

1. Load a validated saved record. A fresh entry is returned without HTTP.
2. After its TTL, or with `refresh: true`, send `If-None-Match` when an ETag is saved; otherwise use `If-Modified-Since` when Last-Modified is available.
3. HTTP 304 reuses the Markdown and original `fetchedAt`, updating the successful `checkedAt` time. HTTP 200 saves the downloaded content and new validators. Without validators, a normal GET checks for changes by content hash.
4. Network failures, timeouts, HTTP 408/429, and HTTP 5xx can return a saved copy marked `stale`. Its successful `checkedAt` is not advanced. Cancellation, redirects, permanent HTTP failures, and invalid Markdown responses remain errors. HTTP 404/410 remove the saved entry.

`cache.status` is one of:

| Status | Meaning |
| --- | --- |
| `miss` | Downloaded without a usable saved entry. |
| `hit` | Reused a saved copy within the configured TTL. |
| `revalidated` | Source confirmed unchanged with 304, or a 200 response had the same content hash. |
| `updated` | A 200 response replaced a saved copy with changed content. |
| `stale` | Source could not be checked; saved content is returned with a warning. |
| `disabled` | Caching is disabled, or the response specifies `Cache-Control: no-store`. |

`cache.checkedAt` records the last successful source check, `cache.persisted` says whether the returned data and metadata were saved, and an optional `cache.warning` explains stale fallback or a disk write failure. A fresh `hit` means fresh under this application's TTL policy, not a source check on every call. A stale fallback may be older than the TTL; inspect its timestamp before relying on freshness. `fetchedAt` remains the last download time; it is separate from both `checkedAt` and the source-declared `lastUpdated`.

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `DOCUMENTATION_MCP_CACHE_DIR` | `~/.cache/documentation-mcp` | Storage directory; use an absolute path for consistent behavior across MCP clients. |
| `DOCUMENTATION_MCP_CACHE_TTL_MS` | `3600000` | Nonnegative integer freshness interval in milliseconds. `0` checks the source on every call. |
| `DOCUMENTATION_MCP_CACHE_ENABLED` | `true` | Set to `false` to disable disk reads and writes. |

Set these variables in your MCP client's server `env` configuration or the shell that launches the process. `.env` files are not loaded automatically.

Files live under `<cache-dir>/v1/<sha256-of-request-url>.json` and contain the Markdown, content hash, timestamps, and HTTP validators. Writes use a private temporary file followed by atomic rename. Invalid JSON, incompatible record versions, URL mismatches, and hash mismatches are treated as cache misses. Disk failures are logged to stderr; a successful online response can still be returned with `persisted: false`. `no-store` removes any previous saved copy. This is an application-level freshness policy rather than a full HTTP caching implementation.

## Next.js catalog

`NextjsAdapter.fetchCatalog(signal?, options?)` loads `https://nextjs.org/docs/llms.txt` through the cache. Pass `{ refresh: true }` as options to check the source immediately. Each catalog entry contains a `path` accepted by `fetchDocument`, a `title`, a canonical `sourceUrl`, and optional `description` and `section` fields. The catalog also records `libraryId`, its own `sourceUrl`, `fetchedAt`, `cache`, and `docVersion` when declared by the source index.

The parser handles linked section headings and nested list entries, normalizes `.md` URLs, trailing slashes, and fragments, and keeps the first entry for each unique document path. API path case and underscores are preserved, including names such as `cacheLife` and `unstable_cache`. External links, URLs outside `/docs/`, query URLs, unsupported paths, and fenced code examples are excluded. A catalog without usable document entries raises an error. `docVersion` is metadata reported by a mutable index; it does not pin subsequent page requests to that version.

After building, let Nest resolve the adapter and its cache dependencies:

```js
import "reflect-metadata";
import { NextjsAdapter } from "./dist/modules/sources/adapters/nextjs.adapter.js";
import { SourcesModule } from "./dist/modules/sources/sources.module.js";
import { NestFactory } from "@nestjs/core";

const app = await NestFactory.createApplicationContext(SourcesModule, { logger: false });
try {
  const adapter = app.get(NextjsAdapter);
  const catalog = await adapter.fetchCatalog();
  const page = catalog.documents.find((entry) => entry.path === "app/getting-started/caching");

  if (page) {
    const document = await adapter.fetchDocument(page.path);
    console.log(document.content);
  }
} finally {
  await app.close();
}
```

Fetching the catalog does not download document contents. `fetchDocument(path, signal?, options?)` also accepts `{ refresh: true }` as its third argument. Source adapters perform network requests only when called, so application startup remains local.

Discovery currently covers pages directly listed by the root index. Links to sub-indexes such as `/docs/pages/llms.txt` are excluded from document entries; recursive catalog discovery is a separate follow-up.

## Markdown document parsing

`MarkdownDocumentParser.parse(source)` accepts an `ISourceDocument` and returns an `IParsedDocument`. The original Markdown and source metadata are preserved. Parsing is local and performs no network requests.

Given a source document returned by the adapter:

```js
import { MarkdownDocumentParser } from "./dist/modules/documentation/parsers/markdown-document.parser.js";

const document = new MarkdownDocumentParser().parse(source);
const examples = document.sections.flatMap((section) => section.codeExamples);
```

- Metadata: YAML `title`, `description`, and `lastUpdated` are extracted and validated. The title falls back to the first H1, then the first heading, then the source path. Invalid YAML or invalid known metadata fields raise an error; source URLs are taken from the adapter, not from frontmatter.
- Sections: top-level Markdown headings form a flat list in source order. Each section contains its heading and the content up to the next heading. `parentId` and `headingPath` preserve nesting without repeating child content inside parents. Content before the first heading becomes an `Introduction` section with depth 0. YAML frontmatter is excluded from sections.
- IDs: section IDs and code IDs are document-local and deterministic for unchanged content. Section IDs use unique heading slugs; they are internal selectors, not verified website anchors.
- Code: fenced, tilde-fenced, and indented blocks, including blocks inside lists or quotations, are attached to their containing section. Each example records parsed `code`, optional `language` and original fence `meta`, plus a verbatim `markdown` excerpt. Parsed code follows CommonMark normalization; the excerpt retains original source characters and line endings.
- Ranges: sections and examples include one-based inclusive `startLine`/`endLine` and JavaScript string `startOffset`/`endOffset` (end exclusive). Their source excerpts can be recovered by slicing the original document with these offsets.

The parser uses remark for CommonMark structure, remark-frontmatter and YAML for metadata, and github-slugger for section IDs. HTML and MDX-looking markup are retained as source data; components and code examples are not evaluated. A dedicated MDX grammar is outside this parser's current scope.

Runtime dependencies include Nest.js, MCP Server SDK, Zod, reflect-metadata, RxJS, and the Markdown parsing libraries. TypeScript, tsx, Vitest, Node.js and Markdown AST types, MCP Client SDK, and MCP Inspector are development dependencies. Exact versions are recorded in `package.json` and `package-lock.json`.

The npm package is private while the initial implementation and release setup are being prepared.
