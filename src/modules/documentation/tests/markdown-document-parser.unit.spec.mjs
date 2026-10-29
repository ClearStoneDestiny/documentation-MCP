import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";

describe("MarkdownDocumentParser", () => {
  const fixture = readFileSync(
    new URL("./fixtures/document.md", import.meta.url),
    "utf8",
  );
  const parser = new MarkdownDocumentParser();

  function source(content = fixture) {
    return {
      libraryId: "nextjs",
      path: "app/guides/example",
      sourceUrl: "https://nextjs.org/docs/app/guides/example",
      fetchedAt: "2026-10-26T10:00:00.000Z",
      format: "markdown",
      content,
    };
  }

  test("reads YAML metadata while preserving the raw document and source provenance", () => {
    const raw = source();
    const parsed = parser.parse(raw);

    expect(parsed).toMatchObject({
      ...raw,
      title: "Example Guide",
      description: "A guide used only for tests.",
      lastUpdated: "2026-10-01",
    });
    expect(parsed.sourceUrl).toBe(raw.sourceUrl);
    expect(raw).not.toHaveProperty("sections");
    expect(parsed.sections[0].content).not.toContain("title: Example Guide");
  });

  test("creates ordered sections with heading breadcrumbs and parent relationships", () => {
    const parsed = parser.parse(source());

    expect(
      parsed.sections.map(({ id, depth, parentId }) => ({
        id,
        depth,
        parentId,
      })),
    ).toEqual([
      { id: "introduction", depth: 0, parentId: undefined },
      { id: "document-heading", depth: 1, parentId: undefined },
      { id: "setup-cache-with-links", depth: 2, parentId: "document-heading" },
      { id: "details", depth: 3, parentId: "setup-cache-with-links" },
      { id: "usage", depth: 2, parentId: "document-heading" },
    ]);
    expect(parsed.sections[3].headingPath).toEqual([
      "Document Heading",
      "Setup cache with links",
      "Details",
    ]);
    expect(parsed.sections[2].content).toContain("[links](/docs/setup)");
    expect(parsed.sections[2].content).not.toContain("### Details");
  });

  test("keeps verbatim section and code excerpts with correct source ranges", () => {
    const raw = source();
    const parsed = parser.parse(raw);
    const excerpts = [
      ...parsed.sections,
      ...parsed.sections.flatMap((section) => section.codeExamples),
    ];

    for (const excerpt of excerpts) {
      const { startOffset, endOffset, startLine, endLine } = excerpt.range;

      expect(excerpt.markdown ?? excerpt.content).toBe(
        raw.content.slice(startOffset, endOffset),
      );
      expect(startLine).toBe(
        raw.content.slice(0, startOffset).split("\n").length,
      );
      expect(endLine).toBe(
        raw.content.slice(0, endOffset - 1).split("\n").length,
      );
    }

    expect(parsed.sections.map((section) => section.content).join("")).toBe(
      raw.content.slice(parsed.sections[0].range.startOffset),
    );
  });

  test("extracts fenced, tilde-fenced, and nested indented code with language and metadata", () => {
    const parsed = parser.parse(source());
    const examples = parsed.sections.flatMap((section) => section.codeExamples);

    expect(
      examples.map(({ id, code, language, meta }) => ({
        id,
        code,
        language,
        meta,
      })),
    ).toEqual([
      {
        id: "code-1",
        code: "const value = 42;\nconsole.log(value);",
        language: "ts",
        meta: 'title="example.ts" highlight={1}',
      },
      {
        id: "code-2",
        code: 'console.log("details");',
        language: "js",
        meta: "title='other.js'",
      },
      {
        id: "code-3",
        code: 'console.log("nested");',
        language: undefined,
        meta: undefined,
      },
    ]);
    expect(
      parsed.sections[2].codeExamples.map((example) => example.id),
    ).toEqual(["code-1"]);
    expect(
      parsed.sections[3].codeExamples.map((example) => example.id),
    ).toEqual(["code-2"]);
  });

  test("handles longer fences containing shorter fences and headings without splitting their contents", () => {
    const content = [
      "# Examples",
      "",
      "````md",
      "# Inside code",
      "```ts",
      "const value = 1;",
      "```",
      "````",
      "",
      "## Actual section",
      "",
      "```",
      "plain example",
      "```",
    ].join("\n");
    const parsed = parser.parse(source(content));

    expect(parsed.sections.map((section) => section.title)).toEqual([
      "Examples",
      "Actual section",
    ]);
    expect(parsed.sections[0].codeExamples[0].code).toContain(
      "# Inside code\n```ts",
    );
    expect(parsed.sections[1].codeExamples[0].language).toBeUndefined();
  });

  test("keeps document-local IDs unique and resets them on every parse", () => {
    const raw = source(
      "Preamble.\n\n# Introduction\n\n#### Repeated\n\n## Repeated\n\n# Repeated",
    );
    const parsed = parser.parse(raw);

    expect(parsed.sections.map((section) => section.id)).toEqual([
      "introduction",
      "introduction-1",
      "repeated",
      "repeated-1",
      "repeated-2",
    ]);
    expect(parsed.sections[2].parentId).toBe("introduction-1");
    expect(parsed.sections[3].parentId).toBe("introduction-1");
    expect(parsed.sections[4].parentId).toBeUndefined();
    expect(parser.parse(raw)).toEqual(parsed);
  });

  test("recognizes setext headings and uses plain heading text as a title fallback", () => {
    const parsed = parser.parse(
      source(
        "Title *with* `code`\n==================\n\nBody.\n\nSubsection\n----------\n\nMore.",
      ),
    );

    expect(parsed.title).toBe("Title with code");
    expect(parsed.sections.map((section) => section.depth)).toEqual([1, 2]);
    expect(parsed.sections[1].parentId).toBe("title-with-code");
  });

  test("uses source paths for headingless documents and retains preamble code", () => {
    const parsed = parser.parse(
      source("Intro text.\n\n```js\nconsole.log(1);\n```"),
    );

    expect(parsed.title).toBe("app/guides/example");
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].depth).toBe(0);
    expect(parsed.sections[0].codeExamples[0].code).toBe("console.log(1);");
  });

  test("preserves CRLF excerpts while reporting one-based source lines", () => {
    const content =
      "# Title\r\n\r\n```ts\r\nconst first = 1;\r\nconst second = 2;\r\n```\r\n\r\n## Next\r\nBody.\r\n";
    const parsed = parser.parse(source(content));

    expect(parsed.content).toBe(content);
    expect(parsed.sections[1].range.startLine).toBe(8);

    const code = parsed.sections[0].codeExamples[0];

    expect(code.range).toMatchObject({ startLine: 3, endLine: 6 });
    expect(code.markdown).toBe(
      "```ts\r\nconst first = 1;\r\nconst second = 2;\r\n```",
    );
  });

  test("preserves HTML and MDX-looking content as source data", () => {
    const content =
      '# Content\n\n<Callout value={dangerousExpression()}>\n\nExample text.\n\n</Callout>\n\n<script>throw new Error("never execute");</script>';
    const parsed = parser.parse(source(content));

    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].content).toBe(content);
  });

  test.each([
    "---\ntitle: [broken\n---\n\n# Body",
    "---\ntitle: 42\n---\n\n# Body",
    "---\n- not\n- an object\n---\n\n# Body",
  ])("reports invalid YAML or invalid known metadata fields", (content) => {
    expect(() => parser.parse(source(content))).toThrow(
      "Invalid documentation frontmatter",
    );
  });

  test("supports empty frontmatter, empty content, and metadata-only documents", () => {
    expect(parser.parse(source("---\n---\n\n# Body")).title).toBe("Body");
    expect(parser.parse(source("")).sections).toEqual([]);
    expect(
      parser.parse(source("---\ntitle: Metadata only\n---")).sections,
    ).toEqual([]);
  });
});
