/**
 * Shared name-matching utility for person extraction.
 *
 * Provides a two-tier matching algorithm:
 * 1. Exact case-insensitive full-name match
 * 2. Partial name-part match (returns only when exactly one person matches)
 */

export interface KnownPerson {
  id: string;
  name: string;
}

const MINIMUM_PART_LENGTH = 2;

/**
 * Matches a single Unicode "word character": any letter or number. Used to
 * decide word boundaries so a name is only matched as a whole word. Unicode
 * property escapes (with the `u` flag) ensure accented letters (e.g. "é" in
 * "José") count as word characters rather than as boundaries.
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Returns true when the substring at [index, index + length) in `text` is
 * bounded by word boundaries on both sides — that is, the character
 * immediately before and immediately after the substring is either absent
 * (start/end of text) or a non-word character. Shared by both matching tiers
 * so a name embedded inside a larger word (e.g. "Ann" in "Planning") is not
 * treated as a match.
 */
function isWordBoundaryMatch(
  text: string,
  index: number,
  length: number,
): boolean {
  const charBefore = index > 0 ? text[index - 1] : "";
  const afterIndex = index + length;
  const charAfter = afterIndex < text.length ? text[afterIndex] : "";
  const boundaryBefore = charBefore === "" || !WORD_CHARACTER.test(charBefore);
  const boundaryAfter = charAfter === "" || !WORD_CHARACTER.test(charAfter);
  return boundaryBefore && boundaryAfter;
}

/**
 * Finds the earliest occurrence of `needle` in `text` that sits on word
 * boundaries, or -1 when no whole-word occurrence exists. Scans past
 * occurrences embedded inside larger words rather than giving up on the first
 * raw hit, preserving the "earliest match" contract for whole-word matches.
 */
function indexOfWholeWord(text: string, needle: string): number {
  let position = text.indexOf(needle);
  while (position !== -1) {
    if (isWordBoundaryMatch(text, position, needle.length)) return position;
    position = text.indexOf(needle, position + 1);
  }
  return -1;
}

/**
 * Splits a name into lowercase parts, filtering out parts shorter
 * than MINIMUM_PART_LENGTH.
 */
function namePartsOf(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length >= MINIMUM_PART_LENGTH);
}

/**
 * Finds a person by name using two-tier matching:
 *
 * 1. **Exact match**: case-insensitive full-name equality.
 * 2. **Partial match**: any name part of the candidate matches any name part
 *    of a known person. Returns a result only when exactly one person matches
 *    (ambiguous partial matches return null).
 */
export function findPersonByName(
  candidateName: string,
  knownPeople: KnownPerson[],
): string | null {
  const candidateLower = candidateName.trim().toLowerCase();
  if (!candidateLower) return null;

  // Tier 1: exact full-name match
  for (const person of knownPeople) {
    if (person.name.toLowerCase() === candidateLower) {
      return person.id;
    }
  }

  // Tier 2: partial name-part match
  const candidateParts = namePartsOf(candidateName);
  if (candidateParts.length === 0) return null;

  const partialMatches: KnownPerson[] = [];

  for (const person of knownPeople) {
    const personParts = namePartsOf(person.name);
    const hasOverlap = candidateParts.some((candidatePart) =>
      personParts.some((personPart) => candidatePart === personPart)
    );
    if (hasOverlap) {
      partialMatches.push(person);
    }
  }

  if (partialMatches.length === 1) {
    return partialMatches[0].id;
  }

  return null;
}

/**
 * Finds a person mentioned in free text using two-tier matching:
 *
 * 1. **Full-name substring**: searches for each known person's full name
 *    in the text (case-insensitive). Returns the earliest positional match.
 * 2. **Name-part substring**: searches for individual name parts (>= 2 chars)
 *    of each known person in the text. Returns a result only when exactly one
 *    person has a matching part found in the text.
 *
 * Full-name matches always take priority over partial matches.
 */
export function findPersonInText(
  text: string,
  knownPeople: KnownPerson[],
): string | null {
  if (!text || knownPeople.length === 0) return null;

  const textLower = text.toLowerCase();

  // Tier 1: full-name substring match. On an equal earliest position the
  // LONGER (more specific) name wins — "Ann Smith" beats "Ann" regardless of
  // list order (EXTR-10).
  let earliestPosition = Infinity;
  let earliestLength = 0;
  let earliestPersonId: string | null = null;

  for (const person of knownPeople) {
    const nameLower = person.name.toLowerCase();
    if (nameLower.length < MINIMUM_PART_LENGTH) continue;
    const position = indexOfWholeWord(textLower, nameLower);
    if (
      position !== -1 &&
      (position < earliestPosition ||
        (position === earliestPosition && nameLower.length > earliestLength))
    ) {
      earliestPosition = position;
      earliestLength = nameLower.length;
      earliestPersonId = person.id;
    }
  }

  if (earliestPersonId) {
    return earliestPersonId;
  }

  // Tier 2: name-part substring match
  const partialTextMatches: KnownPerson[] = [];

  for (const person of knownPeople) {
    const personParts = namePartsOf(person.name);
    const hasPartInText = personParts.some(
      (part) => indexOfWholeWord(textLower, part) !== -1,
    );
    if (hasPartInText) {
      partialTextMatches.push(person);
    }
  }

  if (partialTextMatches.length === 1) {
    return partialTextMatches[0].id;
  }

  return null;
}
