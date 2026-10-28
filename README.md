# Documentation MCP

A local, stdio-based MCP server for official, version-aware library and framework documentation.

The project currently exposes `get_server_info`, `list_libraries`, `list_versions`, `search_docs`, `get_documentation`, and `get_code_examples` over stdio using Nest.js standalone and the official MCP TypeScript SDK v2. A Next.js source adapter, persistent disk cache, Markdown parser, and section index support searching current official documentation, retrieving matching sections, and extracting code examples with freshness metadata. Historical version selection, recursive catalog discovery, resources, and prompts are planned but not implemented yet.

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
npm test          # Build and run cache, parser, adapter, search, and MCP tests with Vitest
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
      utils/                   # Environment configuration and content hashing
      file-cache.service.ts    # Validated reads and atomic JSON writes
      schemas/                 # Versioned storage records and response metadata
      tests/                   # Disk persistence and corruption checks
    code-examples/
      code-examples.module.ts  # Registry and parser dependencies
      code-examples.service.ts # Extract, filter, and rank complete code blocks
      schemas/                 # get_code_examples input/output contracts
      tests/                   # Extraction, filtering, failures, and cancellation
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
        search-docs.tool.ts       # Search registration and indexing progress
        get-code-examples.tool.ts # Code example registration and progress
      tests/
        stdio.unit.spec.mjs # Process-level protocol checks
    search/
      search.module.ts  # Source adapter and parser dependencies
      search.service.ts # Synchronize cached pages, update changed sections, report coverage
      section-index.ts  # Inverted index and weighted BM25 ranking
      schemas/          # search_docs input/output contracts
      utils/            # API-aware tokenization and bounded snippets
      tests/            # Ranking, updates, failures, scope, and cancellation
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

`get_server_info` reports `stage: "search"`. `McpModule` imports `DocumentationModule`, `SearchModule`, `LibrariesModule`, and `CodeExamplesModule`; their tools share the source adapter and existing cache. Startup does not fetch documentation, build an index, or create cache files. Automated tests exercise the cache, parser, search, code extraction, MCP SDK tool calls with mocked HTTP, and stdio discovery with both legacy and current protocol clients.

## search_docs

Example tool arguments:

```json
{
  "library": "nextjs",
  "query": "revalidateTag",
  "path_prefix": "app/api-reference/functions",
  "limit": 5
}
```

| Parameter | Meaning |
| --- | --- |
| `library` | Required; currently `nextjs`. |
| `query` | Required lexical keywords, 1–256 characters. Use the documentation's language (usually English) and API names, e.g. `caching revalidation` or `unstable_cache`. Whitespace, punctuation-only queries, and queries containing only common stop words are rejected. |
| `path_prefix` | Optional exact page or subtree relative to `/docs`, without a trailing slash. `app/guides/data` selects that page and its descendants, but not `app/guides/database`. Restricts downloads as well as results. |
| `limit` | 1–20 matching sections; defaults to 5. |
| `refresh` | Defaults to `false`. Check the catalog and every page in the selected scope now, bypassing TTL. |

The first search loads the catalog and downloads the pages in scope, using at most four concurrent page requests. Omitting `path_prefix` selects every page directly listed in the root catalog and can take longer than a client's default tool timeout. Start with a narrower prefix when appropriate, or configure a longer timeout in your MCP client. When a client requests MCP progress, the tool reports completed page attempts, including failures. Clients that support resetting timeouts on progress can enable that behavior. Request cancellation stops active fetches and prevents new page downloads; concurrent searches synchronize in order, and cancellation also works while waiting.

The process keeps an inverted index of parsed sections in memory. Every search loads its selected pages through the existing cache policy, so fresh saved pages require no HTTP. Content hashes determine which pages need parsing and reindexing. Changed pages replace their old section postings; pages removed from the catalog or failing to load/parse are excluded. Restarting rebuilds the index from cached Markdown on demand. The derived index is not persisted separately. Disabling the disk cache makes each search download its scope again.

Ranking uses BM25 over weighted fields: section title (6), document title (3), ancestor headings (2), path and section body (1). The body includes code examples. Tokenization normalizes Unicode and case, preserves full API identifiers, and also indexes camelCase and snake_case parts. Matches use any query term, with a query-coverage multiplier favoring sections matching more terms. Common English query stop words are ignored. Scores are relative to the selected corpus and are not confidence probabilities; ties use path and source order. This is lexical search without stemming, semantic translation, or historical comparisons. An agent answering a Russian question should formulate technical search keywords in the source language.

Each result includes `path`, the canonical `sourceUrl`, document and section titles, `sectionId`, `headingPath`, one-based inclusive line numbers for the section's own source range, a bounded Markdown snippet (up to 482 JavaScript string units including ellipses), `score`, `matchedTerms`, `contentHash`, `fetchedAt`, and cache metadata. Snippets are excerpts for discovery and can cut across code fences. No website anchors are synthesized from internal section IDs.

Pass a result's `getDocumentation` object directly as the arguments to `get_documentation`. It contains `library`, `path`, `section_id`, and `expected_hash`. Retrieval includes the selected section's descendants; a changed document returns `DOCUMENT_CHANGED`, so search again before retrying. `totalMatches` counts matching sections before `limit` is applied; multiple results can belong to one page.

Inspect `coverage` even when results are empty:

- `scope: "root-catalog"`, `catalogUrl`, optional source-declared `docVersion`, and optional `pathPrefix` describe discovery scope. Nested indexes such as `/docs/pages/llms.txt` are not expanded; this is not full Next.js documentation coverage.
- `catalogDocuments`, `selectedDocuments`, `indexedDocuments`, and `indexedSections` report how much was searched. A prefix with no catalog entries succeeds with zero selected documents.
- `partial`, `failedDocuments`, and `failures` report unavailable or unparseable pages. Failure details include path and code, are sorted and capped at 20, and expose `failuresTruncated` when needed. Failed pages are retried on subsequent calls through the cache policy.
- `staleDocuments`, `catalogCache`, and each result's `cache` expose saved copies whose source could not be checked. `partial` refers to failed indexing, independently of stale content.

A catalog failure returns MCP `isError: true` with `SOURCE_ERROR`. If every selected page fails, the tool returns `INDEX_UNAVAILABLE`. Available pages remain searchable when only some pages fail. Input validation and cancellation follow the same conventions as `get_documentation`.

After building, try a single-page search in Inspector:

```sh
node_modules/.bin/mcp-inspector --cli node dist/main.js \
  --method tools/call --tool-name search_docs \
  --tool-arg library=nextjs \
  --tool-arg query=revalidation \
  --tool-arg path_prefix=app/getting-started/caching
```

## get_code_examples

Extract complete code blocks from current official documentation using lexical keywords in the code, section prose, headings, and page metadata. Code is returned from the source without generation or execution.

```json
{
  "library": "nextjs",
  "query": "revalidateTag",
  "version": "current",
  "filters": {
    "languages": ["typescript", "tsx"],
    "path_prefix": "app/api-reference/functions"
  },
  "limit": 5
}
```

| Parameter | Meaning |
| --- | --- |
| `library` | Required; currently `nextjs`. Discover capabilities with `list_libraries`. |
| `query` | Required lexical keywords, 1–256 characters; use documentation-language keywords and exact API names. |
| `version` | Defaults to `current`, the only available documentation set. Historical versions, exact release numbers, and ranges return `VERSION_UNAVAILABLE` before downloading sources. |
| `filters.languages` | Optional nonempty list of up to 10 fence languages, matched case-insensitively. `js`/`javascript` and `ts`/`typescript` are aliases; `jsx` and `tsx` remain distinct. Untagged blocks are included only when no language filter is set. |
| `filters.path_prefix` | Optional exact page or subtree relative to `/docs`. Restricts downloads as well as results. |
| `limit` | Number of code blocks to return, 1–20; defaults to 5. Filters apply before ranking and limiting. |
| `refresh` | Defaults to `false`. Recheck the catalog and selected pages immediately. |

The compact response has `libraryId`, `version`, `examples`, `totalMatches` before the limit, and `coverage`. Each example includes complete parsed `code`, optional fence `language`/`meta` (which may identify a filename), `sourceUrl`, `sectionTitle`, `fetchedAt`, optional cache metadata, and `getDocumentation`. Code is returned directly and only once per example; the response omits duplicate Markdown, source ranges, ranking scores, token lists, and repeated identifiers. Ranking still determines example order. `getDocumentation` is an optional next step when surrounding context is needed; its arguments retrieve the containing section with a hash check, detecting source changes between extraction and retrieval. Identical blocks at different source locations remain separate examples.

Extraction considers fenced, tilde-fenced, and indented code blocks; empty blocks and inline code are excluded. Sibling code blocks do not become search context for one another. No matches is a successful response with an empty `examples` array. Blocks are returned whole; `limit` bounds their count, not their combined size.

Like `search_docs`, discovery covers only pages directly listed in the root catalog. The first call loads all selected pages with at most four concurrent downloads; subsequent calls reuse the disk cache and rebuild a request-local example index. `coverage` reports indexed documents and examples, catalog-declared `docVersion` when present, stale sources, and partial source/parser failures. The catalog version is metadata from a mutable source, not an immutable revision or a verified compatibility range. If every selected page fails, the tool returns `INDEX_UNAVAILABLE`; catalog failures return `SOURCE_ERROR`. Requests support MCP progress notifications and cancellation.

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
