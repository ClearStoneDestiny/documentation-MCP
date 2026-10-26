import type { IParsedDocument } from "../documentation/interfaces/parsed-document.interface.js";
import type { IIndexedSection } from "./interfaces/indexed-section.interface.js";
import { ISectionMatch } from "./interfaces/section-match.interface.js";
import { tokenize } from "./utils/tokenize.util.js";

interface IEntry {
  section: IIndexedSection;
  frequencies: Map<string, number>;
  length: number;
}

// Process-local inverted index. Markdown remains in the existing disk cache
export class SectionIndex {
  private readonly entries = new Map<string, IEntry>();
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly paths = new Map<string, string[]>();

  remove(path: string): void {
    for (const key of this.paths.get(path) ?? []) {
      const entry = this.entries.get(key)!;

      for (const term of entry.frequencies.keys()) {
        const posting = this.postings.get(term)!;
        posting.delete(key);

        if (!posting.size) {
          this.postings.delete(term);
        }
      }
      this.entries.delete(key);
    }
    this.paths.delete(path);
  }

  retain(paths: ReadonlySet<string>): void {
    for (const path of this.paths.keys()) {
      if (!paths.has(path)) {
        this.remove(path);
      }
    }
  }

  replace(document: IParsedDocument): void {
    this.remove(document.path);
    const keys: string[] = [];

    for (const section of document.sections) {
      const key = JSON.stringify([document.path, section.id]);
      const frequencies = new Map<string, number>();

      const fields: [string, number][] = [
        [document.title, 3],
        [section.title, 6],
        [section.headingPath.slice(0, -1).join(" "), 2],
        [document.path, 1],
        [section.content, 1],
      ];

      for (const [text, weight] of fields) {
        for (const term of tokenize(text)) {
          frequencies.set(term, (frequencies.get(term) ?? 0) + weight);
        }
      }

      this.entries.set(key, {
        section: {
          path: document.path,
          sectionId: section.id,
          title: document.title,
          sectionTitle: section.title,
          headingPath: [...section.headingPath],
          content: section.content,
          startLine: section.range.startLine,
          endLine: section.range.endLine,
        },
        frequencies,
        length: [...frequencies.values()].reduce(
          (sum, value) => sum + value,
          0,
        ),
      });
      keys.push(key);

      for (const [term, frequency] of frequencies) {
        let posting = this.postings.get(term);

        if (!posting) {
          posting = new Map();
          this.postings.set(term, posting);
        }
        posting.set(key, frequency);
      }
    }

    this.paths.set(document.path, keys);
  }

  search(
    terms: readonly string[],
    paths: ReadonlySet<string>,
  ): ISectionMatch[] {
    const scope = new Map(
      [...this.entries].filter(([, entry]) => paths.has(entry.section.path)),
    );

    if (!scope.size || !terms.length) {
      return [];
    }

    const averageLength =
      [...scope.values()].reduce((sum, entry) => sum + entry.length, 0) /
      scope.size;
    const matches = new Map<string, ISectionMatch>();

    // BM25 over weighted field frequencies, restricted to this request's corpus
    for (const term of terms) {
      const posting = [...(this.postings.get(term) ?? [])].filter(([key]) =>
        scope.has(key),
      );
      const idf = Math.log(
        1 + (scope.size - posting.length + 0.5) / (posting.length + 0.5),
      );

      for (const [key, frequency] of posting) {
        const entry = scope.get(key)!;
        const denominator =
          frequency + 1.2 * (0.25 + (0.75 * entry.length) / averageLength);

        let match = matches.get(key);

        if (!match) {
          match = { section: entry.section, score: 0, matchedTerms: [] };
          matches.set(key, match);
        }

        match.score += (idf * frequency * 2.2) / denominator;
        match.matchedTerms.push(term);
      }
    }

    for (const match of matches.values()) {
      match.score *= match.matchedTerms.length / terms.length;
    }

    return [...matches.values()].sort(
      (left, right) =>
        right.score - left.score ||
        left.section.path.localeCompare(right.section.path, "en") ||
        left.section.startLine - right.section.startLine,
    );
  }

  sectionCount(paths: ReadonlySet<string>): number {
    return [...paths].reduce(
      (sum, path) => sum + (this.paths.get(path)?.length ?? 0),
      0,
    );
  }
}
