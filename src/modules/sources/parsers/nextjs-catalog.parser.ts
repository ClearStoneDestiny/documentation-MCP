import {
  NEXTJS_DOCS_BASE_URL,
  NEXTJS_DOCUMENT_PATH_PATTERN,
} from "../constants/nextjs.constant.js";
import type { ISourceCatalog } from "../interfaces/source-catalog.interface.js";
import type { ISourceDocumentReference } from "../interfaces/source-document-reference.interface.js";

function resolveDocumentUrl(
  href: string,
): Pick<ISourceDocumentReference, "path" | "sourceUrl"> | undefined {
  let url: URL;

  try {
    url = new URL(href, NEXTJS_DOCS_BASE_URL);
  } catch {
    return undefined;
  }

  const base = new URL(NEXTJS_DOCS_BASE_URL);

  if (
    url.origin !== base.origin ||
    url.username ||
    url.password ||
    url.search ||
    !url.pathname.startsWith(base.pathname)
  ) {
    return undefined;
  }

  const path = url.pathname
    .slice(base.pathname.length)
    .replace(/\/$/, "")
    .replace(/\.md$/, "");

  if (!NEXTJS_DOCUMENT_PATH_PATTERN.test(path)) {
    return undefined;
  }

  return { path, sourceUrl: new URL(path, base).href };
}

// Parse the link-list format used by Next.js llms.txt, not document Markdown
export function parseNextjsCatalog(
  content: string,
): Pick<ISourceCatalog, "documents" | "docVersion"> {
  const documents: ISourceDocumentReference[] = [];
  const seen = new Set<string>();

  let section: string | undefined;
  let docVersion: string | undefined;
  let fence: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
    const fenceMarker = fenceMatch?.[1];

    if (fence) {
      if (
        fenceMarker &&
        fenceMarker[0] === fence[0] &&
        fenceMarker.length >= fence.length &&
        !fenceMatch?.[2]?.trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (fenceMarker) {
      fence = fenceMarker;
      continue;
    }

    const versionMatch = line.match(/^@doc-version:\s*(\S+)\s*$/);

    if (versionMatch) {
      docVersion ??= versionMatch[1];
      continue;
    }

    const link = line.match(
      /^\s*(?:[-*+]\s+|#{2,6}\s+)\[([^\]]+)\]\(([^\s)]+)\)(?:\s*:\s*(.*))?\s*$/,
    );
    const heading = line.match(/^#{2,6}\s+(.+?)\s*$/);

    if (heading) {
      section = (link?.[1] ?? heading[1])?.trim();
    }

    if (!link?.[1]?.trim() || !link[2]) {
      continue;
    }

    const reference = resolveDocumentUrl(link[2]);

    if (!reference || seen.has(reference.path)) {
      continue;
    }

    seen.add(reference.path);

    const description = link[3]?.trim();
    documents.push({
      ...reference,
      title: link[1].trim(),
      ...(description ? { description } : {}),
      ...(section ? { section } : {}),
    });
  }

  if (!documents.length) {
    throw new Error("No documentation entries found in Next.js catalog");
  }

  return { documents, ...(docVersion ? { docVersion } : {}) };
}
