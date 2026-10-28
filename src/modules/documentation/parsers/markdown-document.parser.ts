import { Injectable } from "@nestjs/common";
import GithubSlugger, { slug } from "github-slugger";
import type { Code, Heading, Nodes, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { parseDocument } from "yaml";
import * as z from "zod/v4";
import type { ISourceDocument } from "../../sources/interfaces/source-document.interface.js";
import type { IDocumentRange } from "../interfaces/document-range.interface.js";
import type { IDocumentSection } from "../interfaces/document-section.interface.js";
import type { IParsedDocument } from "../interfaces/parsed-document.interface.js";

const markdownParser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"]);

const metadataSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  lastUpdated: z.string().optional(),
});

function offsetsOf(node: Nodes): { startOffset: number; endOffset: number } {
  const startOffset = node.position?.start.offset;
  const endOffset = node.position?.end.offset;

  if (startOffset === undefined || endOffset === undefined) {
    throw new Error("Markdown parser did not provide source positions");
  }

  return { startOffset, endOffset };
}

function headingTitle(heading: Heading): string {
  return toString(heading, { includeHtml: false }).trim();
}

function readMetadata(
  tree: Root,
  sourceUrl: string,
): z.infer<typeof metadataSchema> {
  const frontmatter = tree.children[0];

  if (frontmatter?.type !== "yaml") {
    return {};
  }

  try {
    const document = parseDocument(frontmatter.value);

    if (document.errors.length) {
      throw document.errors[0];
    }

    return metadataSchema.parse(document.toJS({ maxAliasCount: 100 }) ?? {});
  } catch (cause) {
    throw new Error(`Invalid documentation frontmatter: ${sourceUrl}`, {
      cause,
    });
  }
}

function collectCode(node: Nodes, codes: Code[]): void {
  if (node.type === "code") {
    codes.push(node);
  }

  if ("children" in node) {
    for (const child of node.children) collectCode(child, codes);
  }
}

function createRangeReader(
  content: string,
): (start: number, end: number) => IDocumentRange {
  const lineStarts = [0];

  for (const match of content.matchAll(/\r\n|\r|\n/g)) {
    lineStarts.push(match.index + match[0].length);
  }

  const lineAt = (offset: number): number => {
    let low = 0;
    let high = lineStarts.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);

      if (lineStarts[middle]! <= offset) {
        low = middle + 1;
      } else high = middle;
    }
    return low;
  };

  return (startOffset, endOffset) => ({
    startOffset,
    endOffset,
    startLine: lineAt(startOffset),
    endLine: lineAt(Math.max(startOffset, endOffset - 1)),
  });
}

@Injectable()
export class MarkdownDocumentParser {
  parse(source: ISourceDocument): IParsedDocument {
    if (source.format !== "markdown") {
      throw new Error(`Unsupported documentation format: ${source.format}`);
    }
    
    const tree = markdownParser.parse(source.content);
    const metadata = readMetadata(tree, source.sourceUrl);

    const headings = tree.children.filter(
      (node): node is Heading => node.type === "heading",
    );
    const firstHeading =
      headings.find((node) => node.depth === 1) ?? headings[0];
    const title =
      metadata.title?.trim() ||
      (firstHeading && headingTitle(firstHeading)) ||
      source.path;
    const description = metadata.description?.trim();

    const lastUpdated = metadata.lastUpdated?.trim();
    const rangeOf = createRangeReader(source.content);

    const boundaries: {
      startOffset: number;
      title: string;
      depth: number;
    }[] = headings.map((node) => ({
      startOffset: offsetsOf(node).startOffset,
      title: headingTitle(node),
      depth: node.depth,
    }));
    const firstBodyNode = tree.children.find((node) => node.type !== "yaml");

    if (firstBodyNode) {
      const startOffset = offsetsOf(firstBodyNode).startOffset;

      if (!boundaries[0] || startOffset < boundaries[0].startOffset) {
        boundaries.unshift({ startOffset, title: "Introduction", depth: 0 });
      }
    }

    const slugger = new GithubSlugger();
    const sections: IDocumentSection[] = [];
    const parents: IDocumentSection[] = [];

    for (const [index, boundary] of boundaries.entries()) {
      while (parents.length && parents.at(-1)!.depth >= boundary.depth) {
        parents.pop();
      }

      const parent = boundary.depth ? parents.at(-1) : undefined;

      const endOffset =
        boundaries[index + 1]?.startOffset ?? source.content.length;

      const section: IDocumentSection = {
        id: slugger.slug(slug(boundary.title) || "section"),
        title: boundary.title,
        depth: boundary.depth,
        ...(parent ? { parentId: parent.id } : {}),
        headingPath: boundary.depth
          ? [...(parent?.headingPath ?? []), boundary.title]
          : [],
        content: source.content.slice(boundary.startOffset, endOffset),
        range: rangeOf(boundary.startOffset, endOffset),
        codeExamples: [],
      };
      sections.push(section);

      if (boundary.depth) {
        parents.push(section);
      }
    }

    const codes: Code[] = [];
    collectCode(tree, codes);

    for (const [index, node] of codes.entries()) {
      const { startOffset, endOffset } = offsetsOf(node);
      const section = sections.find(
        (candidate) =>
          startOffset >= candidate.range.startOffset &&
          startOffset < candidate.range.endOffset,
      );

      section?.codeExamples.push({
        id: `code-${index + 1}`,
        code: node.value,
        ...(node.lang ? { language: node.lang } : {}),
        ...(node.meta ? { meta: node.meta } : {}),
        markdown: source.content.slice(startOffset, endOffset),
        range: rangeOf(startOffset, endOffset),
      });
    }

    return {
      ...source,
      title,
      ...(description ? { description } : {}),
      ...(lastUpdated ? { lastUpdated } : {}),
      sections,
    };
  }
}
