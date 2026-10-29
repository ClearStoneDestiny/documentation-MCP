# Documentation MCP

Give your AI assistant access to official **Next.js** and **React** documentation: search topics, read relevant sections, and retrieve code examples directly from the source.

## Install and connect

Requires **Node.js 22.19.0 or newer**, npm, and an MCP client with **stdio** support.

### 1. Build the server

```sh
git clone https://github.com/ClearStoneDestiny/documentation-MCP.git
cd documentation-MCP
npm ci
npm run build
```

### 2. Add it to your MCP client

Add the following server entry to your client's MCP configuration:

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

Replace `/absolute/path/to/documentation-MCP` with the full path to your checkout. The configuration file's location depends on your client; for clients with a server setup form, select **stdio**, enter `node` as the command, and the full path to `dist/main.js` as its argument.

Your client starts the server automatically. No separate server process, port, or API key is needed. Use `node` directly in the configuration so stdout carries only MCP messages. If your client cannot find Node.js, use the full path to the Node.js executable as `command`.

### 3. Start using it

Restart your client or reload its MCP servers, then check that the `documentation` tools are available. Try asking:

- “Use Documentation MCP to explain React's useState and show examples from the official docs.”
- “Search the Next.js docs for caching and revalidation.”

The first search downloads the selected documentation pages; later requests reuse the local cache. Narrowing a search to a page or section of the documentation reduces the initial download.

## Supported libraries

| Library | ID | Example document path |
| --- | --- | --- |
| Next.js | `nextjs` | `app/getting-started/caching` |
| React | `react` | `reference/react/useState` |

Both libraries are enabled by default and support current documentation. Historical documentation and package-release selection are not available. `list_versions` lists documentation sets; the supported selector is `current`.

## Available tools

| Tool | Purpose |
| --- | --- |
| `get_server_info` | Inspect the server. |
| `list_libraries` | Discover enabled libraries and their supported tools. |
| `list_versions` | List available documentation sets for a library. |
| `search_docs` | Find relevant documentation sections. |
| `get_documentation` | Read a page or a selected section. |
| `get_code_examples` | Retrieve complete code examples from the documentation. |

For example, `search_docs` can target a single React page:

```json
{
  "library": "react",
  "query": "useState",
  "path_prefix": "reference/react/useState",
  "limit": 5
}
```

Search results and code examples include `getDocumentation` arguments for retrieving their surrounding context. Use English keywords and API names for best results. Search covers pages directly listed in each library's root catalog; check the response's `coverage` for partial results.

## Settings

Documentation is fetched on demand and cached locally. The default cache directory is `~/.cache/documentation-mcp`, with a one-hour freshness interval. Tools accept `refresh: true` to check the source immediately. If the source is temporarily unavailable, a saved copy may be returned with stale metadata.

Optional environment variables can be set in your MCP server entry's `env` object:

| Variable | Default | Purpose |
| --- | --- | --- |
| `DOCUMENTATION_MCP_CACHE_DIR` | `~/.cache/documentation-mcp` | Change the cache location; use an absolute path. |
| `DOCUMENTATION_MCP_CACHE_TTL_MS` | `3600000` | Change the freshness interval in milliseconds. |
| `DOCUMENTATION_MCP_CACHE_ENABLED` | `true` | Set to `false` to disable disk caching. |

To disable a library, set `enabled: false` in [library-definitions.constant.ts](src/modules/libraries/constants/library-definitions.constant.ts), rebuild, and restart the MCP server. It will disappear from discovery and become unavailable to tools.

## Development and contributions

Contributions and additional library adapters are welcome.

```sh
npm run dev        # Run with automatic restart
npm run typecheck  # Check TypeScript types
npm test          # Build and run tests
npm run inspector # Build and open MCP Inspector
```

To add a library, implement [ISourceAdapter](src/modules/sources/interfaces/source-adapter.interface.ts), register it in [LIBRARY_DEFINITIONS](src/modules/libraries/constants/library-definitions.constant.ts), and add fixtures and contract tests for its supported tools. Sources with an `llms.txt` catalog and `.md` pages can extend [LlmsMarkdownAdapter](src/modules/sources/adapters/llms-markdown.adapter.ts); [ReactAdapter](src/modules/sources/adapters/react.adapter.ts) is a small example.

Shared services and MCP tools select adapters through the registry. [Configured-library tests](src/modules/mcp/tests/configured-libraries.integration.spec.mjs) cover both built-in adapters, cache and search isolation, and library disabling. Tests use mocked HTTP responses and temporary cache directories.
