/**
 * PeopleExtractor — detects known person mentions in note content.
 *
 * Uses an LLM call to match person names mentioned in the note against
 * the list of known (non-archived) people. Returns matched person UUIDs.
 * Does NOT auto-create new people — only matches against existing records.
 */

import type { ParsedNote } from "../parser.ts";
import type {
  ExtractionContext,
  ExtractionResult,
  Extractor,
} from "./pipeline.ts";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

// ---------------------------------------------------------------------------
// LLM-based person detection
// ---------------------------------------------------------------------------

/**
 * Batch LLM call to detect which known people are mentioned in the note.
 * Returns only valid person IDs from the known list.
 */
async function detectPeopleByContent(
  noteContent: string,
  knownPeople: { id: string; name: string }[],
): Promise<string[]> {
  if (knownPeople.length === 0 || !noteContent.trim()) return [];

  const peopleList = knownPeople
    .map((person) => `- "${person.name}" (id: ${person.id})`)
    .join("\n");

  const validIds = new Set(knownPeople.map((person) => person.id));

  try {
    const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You identify which known people are mentioned in a note. Given a list of known people and note content, return which people are referenced, mentioned by name, or clearly discussed. Only use person IDs from the provided list. If no known people are mentioned, return an empty array.

Return JSON: {"people_ids": ["uuid1", "uuid2"]}

KNOWN PEOPLE:
${peopleList}`,
          },
          {
            role: "user",
            content: noteContent,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(
        `PeopleExtractor LLM call failed: ${response.status} ${errorText}`,
      );
      return [];
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    if (!Array.isArray(parsed.people_ids)) return [];

    return parsed.people_ids.filter(
      (personId: unknown) =>
        typeof personId === "string" && validIds.has(personId),
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
  readonly referenceKey = "people";

  async extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    const allPeople = [
      ...context.knownPeople,
      ...context.newlyCreatedPeople,
    ];

    // Deduplicate by ID
    const uniquePeople = Array.from(
      new Map(allPeople.map((person) => [person.id, person])).values(),
    );

    if (uniquePeople.length === 0) {
      return { referenceKey: this.referenceKey, ids: [] };
    }

    // Build a text summary of the note for the LLM
    const contentParts: string[] = [];
    if (note.title) contentParts.push(`Title: ${note.title}`);
    contentParts.push(note.content);
    const noteContent = contentParts.join("\n").trim();

    if (!noteContent) {
      return { referenceKey: this.referenceKey, ids: [] };
    }

    const detectedIds = await detectPeopleByContent(noteContent, uniquePeople);

    return {
      referenceKey: this.referenceKey,
      ids: detectedIds,
    };
  }
}
