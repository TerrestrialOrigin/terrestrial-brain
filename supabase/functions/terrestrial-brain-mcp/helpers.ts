import { SupabaseClient } from "@supabase/supabase-js";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

export async function getEmbedding(text: string): Promise<number[]> {
  const r = await fetch(`${OPENROUTER_BASE}/embeddings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: text,
    }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    throw new Error(`OpenRouter embeddings failed: ${r.status} ${msg}`);
  }
  const d = await r.json();
  return d.data[0].embedding;
}

export async function extractMetadata(text: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
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
          content: `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        },
        { role: "user", content: text },
      ],
    }),
  });
  const d = await r.json();
  try {
    return JSON.parse(d.choices[0].message.content);
  } catch {
    return { topics: ["uncategorized"], type: "observation" };
  }
}

export async function freshIngest(
  supabase: SupabaseClient,
  content: string,
  title: string | undefined,
  note_id: string | undefined
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  // Fetch active projects for project detection
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .is("archived_at", null);

  const projectList = (projects || [])
    .map((p: { id: string; name: string }) => `- "${p.name}" (id: ${p.id})`)
    .join("\n");

  const projectInstruction = projectList
    ? `\n\nKNOWN PROJECTS (tag thoughts that clearly relate to one of these):\n${projectList}\n\nWhen a thought clearly relates to a known project, return it as an object instead of a plain string:\n{"thought": "the thought text", "project_id": "the-uuid"}\nThoughts with no clear project match should remain plain strings.\nOnly tag a thought if the connection is explicit, not just tangential.`
    : "";

  const splitResponse = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
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
          content: `You split notes into discrete, standalone thoughts for a personal knowledge base.

RULES:
- Each thought must be fully self-contained — readable without any other context
- Preserve specificity: names, dates, project names, tool names, decisions, dollar amounts
- Each thought is 1–3 sentences. No walls of text.
- Prefix decisions with "Decision:", tasks with "TODO:"
- Preserve magical working / ritual / synchronicity framing naturally
- Split on topic boundaries — Java features and a magick working are two separate thoughts
- Skip: bare headings, lone tags, empty sections
- If the entire note is already a single coherent thought, return it as a single-item array

Return ONLY valid JSON: {"thoughts": ["thought 1", "thought 2", ...]}${projectInstruction}`,
        },
        {
          role: "user",
          content: title ? `Note title: ${title}\n\n${content}` : content,
        },
      ],
    }),
  });

  if (!splitResponse.ok) {
    const msg = await splitResponse.text().catch(() => "");
    throw new Error(`OpenRouter split failed: ${splitResponse.status} ${msg}`);
  }

  const splitData = await splitResponse.json();
  const thoughts: { content: string; project_id: string | null }[] = [];

  try {
    const parsed = JSON.parse(splitData.choices[0].message.content);
    if (Array.isArray(parsed.thoughts)) {
      for (const item of parsed.thoughts) {
        if (typeof item === "string" && item.trim().length > 0) {
          thoughts.push({ content: item, project_id: null });
        } else if (typeof item === "object" && item.thought && typeof item.thought === "string" && item.thought.trim().length > 0) {
          thoughts.push({ content: item.thought, project_id: item.project_id || null });
        }
      }
    }
  } catch {
    thoughts.push({ content: content.trim(), project_id: null });
  }

  if (thoughts.length === 0) {
    return {
      content: [{ type: "text" as const, text: "No thoughts extracted — note may be empty." }],
    };
  }

  const results = await Promise.allSettled(
    thoughts.map(async (thought) => {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(thought.content),
        extractMetadata(thought.content),
      ]);
      const { error } = await supabase.from("thoughts").insert({
        content: thought.content,
        embedding,
        reference_id: note_id || null,
        metadata: {
          ...metadata,
          source: "obsidian",
          note_title: title || null,
          ...(thought.project_id ? { references: { project_id: thought.project_id } } : {}),
        },
      });
      if (error) throw new Error(error.message);
    })
  );

  const succeeded = results.filter((r) => r.status === "fulfilled").length;
  const failed = results.filter((r) => r.status === "rejected").length;

  return {
    content: [{
      type: "text" as const,
      text: `Captured ${succeeded} thought${succeeded !== 1 ? "s" : ""} from "${title || "note"}"${failed > 0 ? ` — ${failed} failed` : ""}`,
    }],
    isError: failed === thoughts.length,
  };
}
