/**
 * Structural parser for markdown notes.
 *
 * Deterministic (no AI), zero external dependencies.
 * Extracts checkboxes and headings from markdown content.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedNote {
  content: string;
  title: string | null;
  referenceId: string | null;
  source: string;
  checkboxes: ParsedCheckbox[];
  headings: ParsedHeading[];
}

export interface ParsedCheckbox {
  text: string;
  checked: boolean;
  depth: number;
  lineNumber: number;
  parentIndex: number | null;
  sectionHeading: string | null;
}

export interface ParsedHeading {
  text: string;
  level: number;
  lineStart: number;
  lineEnd: number;
}

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

const CHECKBOX_PATTERN = /^\s*- \[([ xX])\] (.+)$/;
const HEADING_PATTERN = /^(#{1,6})\s+(.+)$/;
const FENCE_PATTERN = /^(\s*)(```|~~~)/;

// ---------------------------------------------------------------------------
// Code block detection
// ---------------------------------------------------------------------------

/**
 * Returns a Set of 1-indexed line numbers that fall inside fenced code blocks.
 */
export function detectCodeBlockLines(lines: string[]): Set<number> {
  const insideCodeBlock = new Set<number>();
  let inBlock = false;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    if (FENCE_PATTERN.test(lines[index])) {
      if (inBlock) {
        // Closing fence — this line is still inside the block
        insideCodeBlock.add(lineNumber);
        inBlock = false;
      } else {
        // Opening fence — this line starts the block
        insideCodeBlock.add(lineNumber);
        inBlock = true;
      }
      continue;
    }
    if (inBlock) {
      insideCodeBlock.add(lineNumber);
    }
  }

  return insideCodeBlock;
}

// ---------------------------------------------------------------------------
// Heading parser
// ---------------------------------------------------------------------------

/**
 * Extracts headings from lines, skipping lines inside code blocks.
 * Line numbers are 1-indexed. `lineEnd` is computed after all headings are
 * collected: a heading's range ends at the line before the next heading of
 * same or higher level (lower or equal `level` number), or at the last line
 * of the file.
 */
export function parseHeadings(
  lines: string[],
  codeBlockLines: Set<number>,
): ParsedHeading[] {
  const headings: ParsedHeading[] = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    if (codeBlockLines.has(lineNumber)) continue;

    const match = lines[index].match(HEADING_PATTERN);
    if (match) {
      headings.push({
        text: match[2],
        level: match[1].length,
        lineStart: lineNumber,
        lineEnd: lines.length, // placeholder — computed below
      });
    }
  }

  // Compute lineEnd for each heading
  const totalLines = lines.length;
  for (let headingIndex = 0; headingIndex < headings.length; headingIndex++) {
    const currentHeading = headings[headingIndex];
    let endLine = totalLines;

    // Scan forward for the next heading at same or higher level
    for (
      let nextIndex = headingIndex + 1;
      nextIndex < headings.length;
      nextIndex++
    ) {
      if (headings[nextIndex].level <= currentHeading.level) {
        endLine = headings[nextIndex].lineStart - 1;
        break;
      }
    }

    currentHeading.lineEnd = endLine;
  }

  return headings;
}

// ---------------------------------------------------------------------------
// Indentation depth
// ---------------------------------------------------------------------------

/**
 * Computes indentation depth from the leading whitespace of a line.
 * Each tab = 1 level. Each group of 2+ consecutive spaces = 1 level.
 */
export function computeIndentDepth(line: string): number {
  let depth = 0;
  let index = 0;

  while (index < line.length) {
    if (line[index] === "\t") {
      depth++;
      index++;
    } else if (line[index] === " ") {
      let spaceCount = 0;
      while (index < line.length && line[index] === " ") {
        spaceCount++;
        index++;
      }
      if (spaceCount >= 2) {
        depth += Math.floor(spaceCount / 2);
      }
    } else {
      break;
    }
  }

  return depth;
}

// ---------------------------------------------------------------------------
// Checkbox parser
// ---------------------------------------------------------------------------

/**
 * Extracts checkboxes from lines, skipping code block lines.
 * Computes depth, parent index, and section heading for each checkbox.
 */
export function parseCheckboxes(
  lines: string[],
  codeBlockLines: Set<number>,
  headings: ParsedHeading[],
): ParsedCheckbox[] {
  const checkboxes: ParsedCheckbox[] = [];

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    if (codeBlockLines.has(lineNumber)) continue;

    const match = lines[index].match(CHECKBOX_PATTERN);
    if (!match) continue;

    const marker = match[1];
    const text = match[2];
    const checked = marker === "x" || marker === "X";
    const depth = computeIndentDepth(lines[index]);

    // Parent detection: nearest preceding checkbox at depth - 1
    let parentIndex: number | null = null;
    if (depth > 0) {
      for (
        let previousIndex = checkboxes.length - 1;
        previousIndex >= 0;
        previousIndex--
      ) {
        if (checkboxes[previousIndex].depth === depth - 1) {
          parentIndex = previousIndex;
          break;
        }
      }
    }

    // Section heading: nearest heading above this line
    let sectionHeading: string | null = null;
    for (
      let headingIndex = headings.length - 1;
      headingIndex >= 0;
      headingIndex--
    ) {
      if (headings[headingIndex].lineStart < lineNumber) {
        sectionHeading = headings[headingIndex].text;
        break;
      }
    }

    checkboxes.push({
      text,
      checked,
      depth,
      lineNumber,
      parentIndex,
      sectionHeading,
    });
  }

  return checkboxes;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Parses raw markdown content into a structured `ParsedNote`.
 */
export function parseNote(
  content: string,
  title: string | null,
  referenceId: string | null,
  source: string,
): ParsedNote {
  const lines = content.split("\n");
  const codeBlockLines = detectCodeBlockLines(lines);
  const headings = parseHeadings(lines, codeBlockLines);
  const checkboxes = parseCheckboxes(lines, codeBlockLines, headings);

  return {
    content,
    title,
    referenceId,
    source,
    checkboxes,
    headings,
  };
}
