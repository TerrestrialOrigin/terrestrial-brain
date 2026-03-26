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

  // Tier 1: full-name substring match (existing behavior)
  let earliestPosition = Infinity;
  let earliestPersonId: string | null = null;

  for (const person of knownPeople) {
    const nameLower = person.name.toLowerCase();
    if (nameLower.length < MINIMUM_PART_LENGTH) continue;
    const position = textLower.indexOf(nameLower);
    if (position !== -1 && position < earliestPosition) {
      earliestPosition = position;
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
    const hasPartInText = personParts.some((part) => {
      const position = textLower.indexOf(part);
      if (position === -1) return false;
      // Ensure word boundary: the match should not be in the middle of a word
      const charBefore = position > 0 ? textLower[position - 1] : " ";
      const charAfter =
        position + part.length < textLower.length
          ? textLower[position + part.length]
          : " ";
      return /\W/.test(charBefore) && /\W/.test(charAfter);
    });
    if (hasPartInText) {
      partialTextMatches.push(person);
    }
  }

  if (partialTextMatches.length === 1) {
    return partialTextMatches[0].id;
  }

  return null;
}
