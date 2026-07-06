import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import type { NoteSnapshotRepository } from "../repositories/note-snapshot-repository.ts";
import type { ThoughtRepository } from "../repositories/thought-repository.ts";

// ─── forget_note — GDPR right-to-erasure pathway (fix-plan Step 25, X7) ───────
// Permanently erases a note's backend footprint: the derived thoughts first,
// then the note snapshot. This is the deliberate HARD-delete exception to the
// system's soft-archive convention — it is user-initiated and never reachable
// from an LLM path. Idempotent: a reference with no snapshot is a success.

export type ForgetNoteOutcome =
  | { ok: true; thoughtsDeleted: number; snapshotExisted: boolean }
  | { ok: false; error: string };

/**
 * Transport-neutral erasure used by both the MCP tool and the /forget-note HTTP
 * route. Order matters: delete thoughts BEFORE the snapshot so an interruption
 * between the two leaves the snapshot resolvable and a re-run can finish.
 */
export async function forgetNote(
  noteSnapshotRepository: NoteSnapshotRepository,
  thoughtRepository: ThoughtRepository,
  referenceId: string,
): Promise<ForgetNoteOutcome> {
  const { data: snapshot, error: lookupError } = await noteSnapshotRepository
    .findIdByReference(referenceId);
  if (lookupError) {
    return { ok: false, error: `Lookup failed: ${lookupError.message}` };
  }

  // Idempotent no-op: nothing was ever synced for this reference.
  if (!snapshot) {
    return { ok: true, thoughtsDeleted: 0, snapshotExisted: false };
  }

  const { data: thoughtsDeleted, error: thoughtsError } =
    await thoughtRepository
      .deleteByNoteSnapshot(snapshot.id);
  if (thoughtsError) {
    return {
      ok: false,
      error: `Failed to delete thoughts: ${thoughtsError.message}`,
    };
  }

  const { error: snapshotError } = await noteSnapshotRepository
    .deleteByReference(referenceId);
  if (snapshotError) {
    return {
      ok: false,
      error: `Failed to delete note snapshot: ${snapshotError.message}`,
    };
  }

  return {
    ok: true,
    thoughtsDeleted: thoughtsDeleted ?? 0,
    snapshotExisted: true,
  };
}

/** Human-facing summary shared by the tool and the HTTP route message. */
export function formatForgetOutcome(
  referenceId: string,
  outcome: Extract<ForgetNoteOutcome, { ok: true }>,
): string {
  if (!outcome.snapshotExisted) {
    return `Nothing to forget for "${referenceId}" (no stored data).`;
  }
  return `Forgot "${referenceId}": erased its note snapshot and ${outcome.thoughtsDeleted} derived thought(s).`;
}

export function register(
  server: McpServer,
  logger: FunctionCallLogger,
  noteSnapshotRepository: NoteSnapshotRepository,
  thoughtRepository: ThoughtRepository,
) {
  server.registerTool(
    "forget_note",
    {
      title: "Forget Note",
      description:
        "Permanently erase a note's backend data — its note snapshot and every " +
        "thought derived from it — given the note's reference id (its " +
        "vault-relative path). This is a hard delete for GDPR erasure, NOT the " +
        "usual soft-archive; use it only to honour an explicit 'forget this note' " +
        "request. Tasks, projects, and people are not affected. Idempotent: " +
        "forgetting an unsynced or already-forgotten note succeeds as a no-op.",
      inputSchema: {
        note_id: z.string().min(1).max(1024).describe(
          "The note's reference id (vault-relative path) to erase",
        ),
      },
    },
    withMcpLogging("forget_note", async ({ note_id }) => {
      const outcome = await forgetNote(
        noteSnapshotRepository,
        thoughtRepository,
        note_id,
      );
      if (!outcome.ok) {
        return errorResult(`Failed to forget note: ${outcome.error}`);
      }
      return textResult(formatForgetOutcome(note_id, outcome));
    }, logger),
  );
}
