/**
 * PeopleExtractor — detects person mentions in note content.
 *
 * Uses an LLM call to detect ALL person names mentioned in the note.
 * Matches detected names against known people, and auto-creates new
 * people records for previously unseen names.
 */

import type { ParsedNote } from "../parser.ts";
import type {
  ExtractionContext,
  ExtractionResult,
  Extractor,
  KnownPerson,
} from "./pipeline.ts";
import { isRecord, REFERENCE_KEYS } from "./pipeline.ts";
import { findPersonByName } from "./name-matching.ts";
import type { AiProvider } from "../ai/ai-provider.ts";

// ---------------------------------------------------------------------------
// LLM-based person detection
// ---------------------------------------------------------------------------

interface DetectedPerson {
  name: string;
  knownId: string | null;
}

/**
 * Batch LLM call to detect all person names in the note. Returns both
 * matched known people (with their IDs) and new names to auto-create.
 *
 * Any transport/parse failure degrades to an empty list (detection is
 * best-effort) — the provider's typed errors are caught here so a missing
 * person never aborts extraction.
 */
async function detectAllPeople(
  noteContent: string,
  knownPeople: KnownPerson[],
  aiProvider: AiProvider,
): Promise<DetectedPerson[]> {
  if (!noteContent.trim()) return [];

  const peopleList = knownPeople.length > 0
    ? knownPeople.map((person) => `- "${person.name}" (id: ${person.id})`).join(
      "\n",
    )
    : "(none)";

  const validIds = new Set(knownPeople.map((person) => person.id));

  try {
    return await aiProvider.completeJson(
      {
        purpose: "detect-people",
        systemPrompt:
          `You identify people mentioned in a note. Given note content and a list of known people, return ALL person names detected.

For each person found:
- If they match a known person, return their ID
- If the note uses only a first name or last name, match it to a known person when there is exactly one clear match (e.g., "Bub" matches "Bub Goodwin" if no other known person has the first name "Bub")
- If they are a NEW person not in the known list, return their name with id: null

Only detect real human names — not product names, company names, or fictional characters.
Skip generic references like "the user", "someone", "they".

Return JSON: {"people": [{"name": "Alice", "id": "uuid-if-known-or-null"}, ...]}

KNOWN PEOPLE:
${peopleList}`,
        userContent: noteContent,
      },
      (raw): DetectedPerson[] => {
        const parsed: { people?: unknown } = isRecord(raw) ? raw : {};
        if (!Array.isArray(parsed.people)) return [];
        // One malformed element is skipped, never allowed to throw and drop
        // the whole batch (EXTR-8).
        return parsed.people
          .filter(
            (entry): entry is { name: string; id?: unknown } =>
              isRecord(entry) && typeof entry.name === "string" &&
              entry.name.trim().length > 0,
          )
          .map((entry) => ({
            name: entry.name.trim(),
            knownId: typeof entry.id === "string" && validIds.has(entry.id)
              ? entry.id
              : null,
          }));
      },
    );
  } catch (error) {
    console.error(
      `PeopleExtractor LLM detection error: ${(error as Error).message}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// PeopleExtractor
// ---------------------------------------------------------------------------

export class PeopleExtractor implements Extractor {
  readonly referenceKey = REFERENCE_KEYS.people;

  async extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    // Build note content for LLM
    const contentParts: string[] = [];
    if (note.title) contentParts.push(`Title: ${note.title}`);
    contentParts.push(note.content);
    const noteContent = contentParts.join("\n").trim();

    if (!noteContent) {
      return { referenceKey: this.referenceKey, ids: [] };
    }

    const allPeople = [
      ...context.knownPeople,
      ...context.newlyCreatedPeople,
    ];
    const uniquePeople = Array.from(
      new Map(allPeople.map((person) => [person.id, person])).values(),
    );

    const detectedPeople = await detectAllPeople(
      noteContent,
      uniquePeople,
      context.aiProvider,
    );
    const resultIds: string[] = [];
    // Accumulate auto-create failures so the runner can report partial failure
    // instead of silently dropping people (EXTR-6).
    const errors: string[] = [];

    for (const detected of detectedPeople) {
      if (detected.knownId) {
        // Known person — just include their ID
        if (!resultIds.includes(detected.knownId)) {
          resultIds.push(detected.knownId);
        }
      } else {
        // New person — check if already known by case-insensitive name match
        const existingMatch = findPersonByName(detected.name, uniquePeople);
        if (existingMatch) {
          if (!resultIds.includes(existingMatch)) {
            resultIds.push(existingMatch);
          }
        } else {
          // Auto-create
          const newId = await this.createPerson(detected.name, context, errors);
          if (newId && !resultIds.includes(newId)) {
            resultIds.push(newId);
          }
        }
      }
    }

    return {
      referenceKey: this.referenceKey,
      ids: resultIds,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Inserts a new person record and adds it to the context so downstream
   * extractors (TaskExtractor) can use it immediately. On failure, records a
   * message in `errors` (returned to the runner) as well as logging it.
   */
  private async createPerson(
    name: string,
    context: ExtractionContext,
    errors: string[],
  ): Promise<string | null> {
    const { data: newPerson, error } = await context.personRepository.insert({
      name,
    });

    if (!error && newPerson) {
      context.newlyCreatedPeople.push({
        id: newPerson.id,
        name: newPerson.name,
      });
      context.knownPeople.push({
        id: newPerson.id,
        name: newPerson.name,
      });
      return newPerson.id;
    }

    // Interleave recovery (EXTR-7): `people.name` is unique, so a concurrent
    // ingest of the same new name makes the losing insert fail 23505. Recover
    // the winner's id via create-or-get instead of dropping the person.
    if (error?.code === "23505") {
      const { data: existing, error: lookupError } = await context
        .personRepository.findByName(name);
      if (!lookupError && existing) {
        context.knownPeople.push({ id: existing.id, name: existing.name });
        return existing.id;
      }
      const recoveryMessage =
        `PeopleExtractor auto-create raced for "${name}" and recovery lookup ${
          lookupError ? `failed: ${lookupError.message}` : "found no row"
        }`;
      console.error(recoveryMessage);
      errors.push(recoveryMessage);
      return null;
    }

    const message =
      `PeopleExtractor auto-create failed for "${name}": ${error?.message}`;
    console.error(message);
    errors.push(message);
    return null;
  }
}
