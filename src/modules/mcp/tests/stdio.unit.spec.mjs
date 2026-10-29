import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const serverPath = fileURLToPath(
  new URL("../../../../dist/main.js", import.meta.url),
);
const packageInfo = JSON.parse(
  readFileSync(new URL("../../../../package.json", import.meta.url), "utf8"),
);

for (const [name, mode] of [
  ["legacy initialization", "legacy"],
  ["modern discovery", { pin: "2026-07-28" }],
]) {
  test(
    `stdio supports ${name} and tool calls`,
    { timeout: 10_000 },
    async ({ onTestFinished }) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        // Verify resolution does not depend on the client's working directory
        cwd: tmpdir(),
        stderr: "pipe",
      });
      transport.stderr?.resume();

      const client = new Client(
        { name: "documentation-mcp-smoke-test", version: "1.0.0" },
        { versionNegotiation: { mode } },
      );
      onTestFinished(() => client.close());

      const errors = [];
      client.onerror = (error) => errors.push(error);

      await client.connect(transport, { timeout: 5_000 });

      const { tools } = await client.listTools();
      expect(tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "get_server_info" }),
          expect.objectContaining({ name: "get_documentation" }),
          expect.objectContaining({ name: "search_docs" }),
          expect.objectContaining({ name: "list_versions" }),
          expect.objectContaining({ name: "list_libraries" }),
          expect.objectContaining({ name: "get_code_examples" }),
        ]),
      );

      const result = await client.callTool({
        name: "get_server_info",
        arguments: {},
      });

      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({
        name: packageInfo.name,
        version: packageInfo.version,
        stage: "search",
      });
      expect(errors, "stdout must contain only valid MCP messages").toEqual([]);

      const invalid = await client.callTool({
        name: "get_documentation",
        arguments: { library: "unknown-library", path: "app/guides/example" },
      });
      expect(invalid.isError).toBe(true);

      const invalidSearch = await client.callTool({
        name: "search_docs",
        arguments: { library: "unknown-library", query: "caching" },
      });
      expect(invalidSearch.isError).toBe(true);

      const invalidVersions = await client.callTool({
        name: "list_versions",
        arguments: { library: "unknown-library" },
      });
      expect(invalidVersions.isError).toBe(true);

      const libraries = await client.callTool({
        name: "list_libraries",
        arguments: {},
      });
      expect(libraries.isError).not.toBe(true);
      expect(libraries.structuredContent).toEqual({
        libraries: [
          {
            id: "nextjs",
            name: "Next.js",
            documentationUrl: "https://nextjs.org/docs/",
            capabilities: {
              tools: [
                "get_documentation",
                "search_docs",
                "list_versions",
                "get_code_examples",
              ],
              historicalDocumentation: false,
            },
          },

          {
            id: "react",
            name: "React",
            documentationUrl: "https://react.dev/",
            capabilities: {
              tools: [
                "get_documentation",
                "search_docs",
                "list_versions",
                "get_code_examples",
              ],
              historicalDocumentation: false,
            },
          },
        ],
      });
      expect(JSON.parse(libraries.content[0].text)).toEqual(
        libraries.structuredContent,
      );

      const invalidLibraries = await client.callTool({
        name: "list_libraries",
        arguments: { filter: " " },
      });
      expect(invalidLibraries.isError).toBe(true);

      const unsupportedVersion = await client.callTool({
        name: "get_code_examples",
        arguments: { library: "nextjs", query: "cache", version: "14" },
      });
      expect(unsupportedVersion.isError).toBe(true);
      expect(JSON.parse(unsupportedVersion.content[0].text).code).toBe(
        "VERSION_UNAVAILABLE",
      );
      expect(errors, "stdout must contain only valid MCP messages").toEqual([]);
    },
  );
}

test(
  "exits cleanly when stdin closes and keeps startup logs off stdout",
  { timeout: 5_000 },
  async ({ onTestFinished }) => {
    const child = spawn(process.execPath, [serverPath], { stdio: "pipe" });

    onTestFinished(() => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });

    const closed = once(child, "close");
    child.stdin.end();
    const [code, signal] = await closed;

    expect(code, stderr).toBe(0);
    expect(signal).toBeNull();
    expect(stdout).toBe("");
    expect(stderr).toMatch(/Starting Nest application/);
  },
);
