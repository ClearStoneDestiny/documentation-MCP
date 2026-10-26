import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import { DocumentationService } from "../../../../dist/modules/documentation/documentation.service.js";
import { MarkdownDocumentParser } from "../../../../dist/modules/documentation/parsers/markdown-document.parser.js";

const fixture = readFileSync(
  new URL("./fixtures/document.md", import.meta.url),
  "utf8",
);
const request = { library: "nextjs", path: "app/guides/example" };

function setup(content = fixture) {
  const source = {
    libraryId: "nextjs",
    path: request.path,
    sourceUrl: `https://nextjs.org/docs/${request.path}`,
    fetchedAt: "2026-10-26T10:00:00.000Z",
    format: "markdown",
    content,
  };
  const adapter = { fetchDocument: vi.fn().mockResolvedValue(source) };
  return {
    source,
    adapter,
    service: new DocumentationService(adapter, new MarkdownDocumentParser()),
  };
}

test("fetches and parses a page with metadata, an outline, and a complete Markdown response", async () => {
  const { service, adapter, source } = setup();
  const result = await service.getDocumentation(request);

  expect(adapter.fetchDocument).toHaveBeenCalledExactlyOnceWith(
    request.path,
    undefined,
  );
  expect(result).toMatchObject({
    libraryId: "nextjs",
    path: request.path,
    sourceUrl: source.sourceUrl,
    title: "Example Guide",
    description: "A guide used only for tests.",
    lastUpdated: "2026-10-01",
    fetchedAt: source.fetchedAt,
    channel: "current",
    content: fixture,
    selectedSectionId: null,
    pagination: {
      offset: 0,
      totalChars: fixture.length,
      truncated: false,
      nextOffset: null,
    },
  });
  expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
  expect(result.sections.map((section) => section.id)).toContain(
    "setup-cache-with-links",
  );
  expect(result.sections[0]).not.toHaveProperty("content");
});

test("selects a section including its descendants but excludes the next sibling", async () => {
  const { service } = setup();
  const result = await service.getDocumentation({
    ...request,
    section_id: "setup-cache-with-links",
  });

  expect(result.content).toBe(
    fixture.slice(fixture.indexOf("## Setup"), fixture.indexOf("## Usage")),
  );
  expect(result.content).toContain("### Details");
  expect(result.content).toContain('console.log("details");');
  expect(result.selectedSectionId).toBe("setup-cache-with-links");
});

test("selects only the preamble for the synthetic Introduction section", async () => {
  const { service } = setup();
  const result = await service.getDocumentation({
    ...request,
    section_id: "introduction",
  });

  expect(result.content).toContain("Introductory text");
  expect(result.content).not.toContain("# Document Heading");
  expect(result.content).not.toContain("title: Example Guide");
});

test("reports a missing section with a recoverable error", async () => {
  const { service } = setup();
  await expect(
    service.getDocumentation({ ...request, section_id: "missing" }),
  ).rejects.toMatchObject({ code: "SECTION_NOT_FOUND" });
});

test.each([undefined, "setup"])(
  "reconstructs paginated Markdown for selection %s",
  async (section_id) => {
    const content = `# Page\n\n## Setup\n\n${"Example text. ".repeat(90)}\n\n### Details\nMore.\n\n## Other\nEnd.`;
    const { service } = setup(content);
    const options = { ...request, section_id, max_chars: 256 };
    const full = await service.getDocumentation({
      ...options,
      max_chars: 40_000,
    });
    let page = await service.getDocumentation(options);
    let reconstructed = page.content;
    expect(page.pagination.truncated).toBe(true);

    while (page.pagination.nextOffset !== null) {
      const previousOffset = page.pagination.offset;
      page = await service.getDocumentation({
        ...options,
        offset: page.pagination.nextOffset,
        expected_hash: page.contentHash,
      });
      expect(page.pagination.offset).toBeGreaterThan(previousOffset);
      expect(page.content.length).toBeLessThanOrEqual(256);
      reconstructed += page.content;
    }

    expect(reconstructed).toBe(full.content);
    expect(page.pagination.truncated).toBe(false);
  },
);

test("detects a source change rather than mixing document revisions", async () => {
  const { service, source, adapter } = setup();
  const first = await service.getDocumentation({ ...request, max_chars: 256 });
  adapter.fetchDocument.mockResolvedValue({
    ...source,
    content: `${fixture}\nChanged.`,
  });

  await expect(
    service.getDocumentation({
      ...request,
      offset: first.pagination.nextOffset,
      expected_hash: first.contentHash,
    }),
  ).rejects.toMatchObject({ code: "DOCUMENT_CHANGED" });
});

test("keeps Unicode characters intact at pagination boundaries", async () => {
  const prefix = "# Page\n\n";
  const content = `${prefix}${"a".repeat(255 - prefix.length)}😀suffix`;
  const { service } = setup(content);
  const first = await service.getDocumentation({ ...request, max_chars: 256 });
  const second = await service.getDocumentation({
    ...request,
    max_chars: 256,
    offset: first.pagination.nextOffset,
    expected_hash: first.contentHash,
  });

  expect(first.content.length).toBe(255);
  expect(second.content).toBe("😀suffix");
  expect(first.content + second.content).toBe(content);
  await expect(
    service.getDocumentation({
      ...request,
      offset: 256,
      expected_hash: first.contentHash,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

test("allows an end offset and rejects an offset beyond the selection", async () => {
  const { service } = setup();
  const first = await service.getDocumentation(request);
  const end = await service.getDocumentation({
    ...request,
    offset: fixture.length,
    expected_hash: first.contentHash,
  });
  expect(end.content).toBe("");
  expect(end.pagination.nextOffset).toBeNull();
  await expect(
    service.getDocumentation({
      ...request,
      offset: fixture.length + 1,
      expected_hash: first.contentHash,
    }),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

test.each([
  { library: "react" },
  { path: "https://nextjs.org/docs/app/guides/example" },
  { max_chars: 0 },
  { offset: 1 },
  { version: "14" },
])(
  "rejects invalid requests before downloading a document: %j",
  async (invalid) => {
    const { service, adapter } = setup();
    await expect(
      service.getDocumentation({ ...request, ...invalid }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(adapter.fetchDocument).not.toHaveBeenCalled();
  },
);

test("distinguishes source failures from parser failures", async () => {
  const { service, adapter } = setup();
  adapter.fetchDocument.mockRejectedValue(new Error("HTTP 503"));
  await expect(service.getDocumentation(request)).rejects.toMatchObject({
    code: "SOURCE_ERROR",
    message: "HTTP 503",
  });

  const invalid = setup("---\ntitle: [broken\n---\nBody.");
  await expect(invalid.service.getDocumentation(request)).rejects.toMatchObject(
    { code: "PARSE_ERROR" },
  );
});

test("honors cancellation before a request and forwards the signal to the adapter", async () => {
  const { service, adapter } = setup();
  const controller = new AbortController();
  await service.getDocumentation(request, controller.signal);
  expect(adapter.fetchDocument).toHaveBeenCalledWith(
    request.path,
    controller.signal,
  );
  adapter.fetchDocument.mockClear();
  const reason = new Error("Cancelled by caller");
  controller.abort(reason);

  await expect(
    service.getDocumentation(request, controller.signal),
  ).rejects.toBe(reason);
  expect(adapter.fetchDocument).not.toHaveBeenCalled();
});
