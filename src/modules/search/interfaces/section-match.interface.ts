import { IIndexedSection } from "./indexed-section.interface.js";

export interface ISectionMatch {
  section: IIndexedSection;
  score: number;
  matchedTerms: string[];
}
