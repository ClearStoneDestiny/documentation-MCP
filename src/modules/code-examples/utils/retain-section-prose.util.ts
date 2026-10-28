import { IDocumentSection } from "../../documentation/interfaces/document-section.interface.js";

// Retain prose as search context without making sibling code blocks match
export function retainSectionProse(section: IDocumentSection): string {
  let end = section.range.startOffset;
  let prose = "";

  for (const example of section.codeExamples) {
    prose += section.content.slice(
      end - section.range.startOffset,
      example.range.startOffset - section.range.startOffset,
    );
    prose += "\n";
    end = example.range.endOffset;
  }
  
  return prose + section.content.slice(end - section.range.startOffset);
}
