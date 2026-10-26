import { afterEach, expect, test, vi } from "vitest";
import { NextjsAdapter } from "../../../../dist/modules/sources/adapters/nextjs.adapter.js";

const path = "app/getting-started/caching";
const markdown =
  "# Example documentation\n\n## Example\n\n```ts\nconst value = 42;\n```\n";

afterEach(() => {
  vi.unstubAllGlobals();
});

test.each(["text/markdown; charset=utf-8", "text/plain"])(
  "loads Markdown with content type %s and preserves code",
  async (contentType) => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(markdown, {
        headers: { "Content-Type": contentType },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const document = await new NextjsAdapter().fetchDocument(path);

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://nextjs.org/docs/app/getting-started/caching.md",
    );
    expect(document).toEqual({
      libraryId: "nextjs",
      path,
      sourceUrl: "https://nextjs.org/docs/app/getting-started/caching",
      content: markdown,
      format: "markdown",
      fetchedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(document.fetchedAt))).toBe(false);
  },
);

test.each([
  "https://example.com/docs",
  "../package.json",
  "app/../secret",
  "app/%2e%2e/secret",
  "app/caching?version=old",
])(
  "rejects invalid document path %s before making a request",
  async (invalidPath) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new NextjsAdapter().fetchDocument(invalidPath),
    ).rejects.toThrow("Invalid Next.js documentation path");
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

test.each([404, 429, 503])(
  "reports HTTP %s instead of returning an error page as documentation",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Error", { status })),
    );

    await expect(new NextjsAdapter().fetchDocument(path)).rejects.toThrow(
      `(${status})`,
    );
  },
);

test("rejects an HTML response instead of treating it as Markdown", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("<html>Error</html>", {
        headers: { "Content-Type": "text/html" },
      }),
    ),
  );

  await expect(new NextjsAdapter().fetchDocument(path)).rejects.toThrow(
    "Expected Markdown",
  );
});

test("rejects an empty document", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(" \n ", {
        headers: { "Content-Type": "text/markdown" },
      }),
    ),
  );

  await expect(new NextjsAdapter().fetchDocument(path)).rejects.toThrow(
    "Empty Next.js documentation",
  );
});

test("forwards caller cancellation to the request", async () => {
  const controller = new AbortController();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        }),
    ),
  );

  const request = new NextjsAdapter().fetchDocument(path, controller.signal);
  const assertion = expect(request).rejects.toThrow("Request cancelled");
  controller.abort(new Error("Request cancelled"));

  await assertion;
});
