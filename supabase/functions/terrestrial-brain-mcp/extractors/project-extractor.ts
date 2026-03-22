/**
 * ProjectExtractor — detects project associations from parsed notes.
 *
 * Detection signals (in priority order):
 * 1. File path: `projects/{name}/` pattern in referenceId
 * 2. Heading match: case-insensitive comparison against known projects
 * 3. LLM content matching: focused AI call for remaining associations
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
// File path detection
// ---------------------------------------------------------------------------

/**
 * Extracts the project folder name from a referenceId matching
 * `projects/{name}/...`. Returns null if no match or empty name.
 */
export function extractProjectFolderName(
  referenceId: string | null,
): string | null {
  if (!referenceId) return null;

  // Match "projects/{name}/" where name is non-empty
  const match = referenceId.match(/^projects\/([^/]+)\//);
  if (!match) return null;

  const folderName = match[1].trim();
  return folderName.length > 0 ? folderName : null;
}

// ---------------------------------------------------------------------------
// Heading-based detection
// ---------------------------------------------------------------------------

/**
 * Returns project IDs whose name matches any heading (case-insensitive).
 */
function detectProjectsByHeadings(
  note: ParsedNote,
  knownProjects: { id: string; name: string }[],
): string[] {
  if (knownProjects.length === 0 || note.headings.length === 0) return [];

  const matchedIds: string[] = [];

  for (const heading of note.headings) {
    const headingLower = heading.text.toLowerCase().trim();
    for (const project of knownProjects) {
      if (project.name.toLowerCase() === headingLower) {
        matchedIds.push(project.id);
      }
    }
  }

  return matchedIds;
}

// ---------------------------------------------------------------------------
// LLM content matching
// ---------------------------------------------------------------------------

/**
 * Builds a summary of the note for the LLM call: title, heading structure,
 * and first ~200 chars of each section.
 */
function buildNoteSummary(note: ParsedNote): string {
  const parts: string[] = [];

  if (note.title) {
    parts.push(`Title: ${note.title}`);
  }

  if (note.headings.length > 0) {
    parts.push("Sections:");
    const lines = note.content.split("\n");
    for (const heading of note.headings) {
      const sectionLines = lines.slice(
        heading.lineStart - 1,
        heading.lineEnd,
      );
      const sectionText = sectionLines.join("\n").substring(0, 200);
      parts.push(`  ${"#".repeat(heading.level)} ${heading.text}: ${sectionText}`);
    }
  } else {
    // No headings — just use first 400 chars of content
    parts.push(`Content: ${note.content.substring(0, 400)}`);
  }

  return parts.join("\n");
}

/**
 * Uses a focused LLM call to detect project mentions in note content.
 * Returns only IDs that exist in the known projects list.
 */
async function detectProjectsByContent(
  note: ParsedNote,
  knownProjects: { id: string; name: string }[],
): Promise<string[]> {
  if (knownProjects.length === 0) return [];

  const projectList = knownProjects
    .map((project) => `- "${project.name}" (id: ${project.id})`)
    .join("\n");

  const noteSummary = buildNoteSummary(note);

  const validIds = new Set(knownProjects.map((project) => project.id));

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
            content: `You identify which projects a note is about. You are given a note summary and a list of known projects. Return ONLY project IDs from the list that the note clearly references or relates to. Do not invent new projects. If no projects match, return an empty array.

Return JSON: {"project_ids": ["uuid1", "uuid2"]}

KNOWN PROJECTS:
${projectList}`,
          },
          {
            role: "user",
            content: noteSummary,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.error(
        `ProjectExtractor LLM call failed: ${response.status} ${errorText}`,
      );
      return [];
    }

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);

    if (!Array.isArray(parsed.project_ids)) return [];

    // Only accept IDs that exist in the known projects list
    return parsed.project_ids.filter(
      (id: unknown) => typeof id === "string" && validIds.has(id),
    );
  } catch (error) {
    console.error(
      `ProjectExtractor LLM content matching error: ${(error as Error).message}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// ProjectExtractor
// ---------------------------------------------------------------------------

export class ProjectExtractor implements Extractor {
  readonly referenceKey = "projects";

  async extract(
    note: ParsedNote,
    context: ExtractionContext,
  ): Promise<ExtractionResult> {
    const matchedIds: string[] = [];

    // Signal 1: File path detection
    const folderName = extractProjectFolderName(note.referenceId);
    if (folderName) {
      const existingProject = context.knownProjects.find(
        (project) => project.name.toLowerCase() === folderName.toLowerCase(),
      );

      if (existingProject) {
        matchedIds.push(existingProject.id);
      } else {
        // Auto-create project from folder structure
        const { data: newProject, error } = await context.supabase
          .from("projects")
          .insert({ name: folderName })
          .select("id, name")
          .single();

        if (!error && newProject) {
          matchedIds.push(newProject.id);
          context.newlyCreatedProjects.push({
            id: newProject.id,
            name: newProject.name,
          });
          context.knownProjects.push({
            id: newProject.id,
            name: newProject.name,
          });
        } else {
          console.error(
            `ProjectExtractor auto-create failed for "${folderName}": ${error?.message}`,
          );
        }
      }
    }

    // Signal 2: Heading-based detection
    const headingIds = detectProjectsByHeadings(note, context.knownProjects);
    matchedIds.push(...headingIds);

    // Signal 3: LLM content matching (only if there are projects to match against)
    const contentIds = await detectProjectsByContent(
      note,
      context.knownProjects,
    );
    matchedIds.push(...contentIds);

    // Deduplicate
    const uniqueIds = [...new Set(matchedIds)];

    return {
      referenceKey: this.referenceKey,
      ids: uniqueIds,
    };
  }
}
