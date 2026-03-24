import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MCP_ACCESS_KEY = Deno.env.get("MCP_ACCESS_KEY")!;
const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_CAPTURE_CHANNEL = Deno.env.get("SLACK_CAPTURE_CHANNEL")!;

const MCP_ENDPOINT = `${SUPABASE_URL}/functions/v1/terrestrial-brain-mcp`;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Calls the MCP server's capture_thought tool via Streamable HTTP transport.
 * Sends a JSON-RPC batch: initialize → initialized notification → tools/call.
 */
async function callCaptureThought(content: string): Promise<{ text: string; isError: boolean }> {
  const response = await fetch(MCP_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-brain-key": MCP_ACCESS_KEY,
    },
    body: JSON.stringify([
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ingest-thought", version: "1.0.0" },
        },
      },
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "capture_thought",
          arguments: { content },
        },
      },
    ]),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`MCP request failed: ${response.status} ${errorText}`);
  }

  const results = await response.json();

  // Response is a JSON-RPC batch — find the tools/call response (id: 2)
  const toolResult = Array.isArray(results)
    ? results.find((result: Record<string, unknown>) => result.id === 2)
    : results;

  if (!toolResult) {
    throw new Error("No response received for tools/call request");
  }

  if (toolResult.error) {
    const errorInfo = toolResult.error as Record<string, unknown>;
    throw new Error(`MCP tool error: ${errorInfo.message}`);
  }

  const resultContent = toolResult.result?.content;
  const textItem = Array.isArray(resultContent)
    ? resultContent.find((item: Record<string, unknown>) => item.type === "text")
    : null;

  return {
    text: textItem?.text || "Captured successfully",
    isError: toolResult.result?.isError || false,
  };
}

async function replyInSlack(channel: string, threadTs: string, text: string): Promise<void> {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, thread_ts: threadTs, text }),
  });
}

async function processMessage(event: Record<string, unknown>): Promise<void> {
  const messageText = event.text as string;
  const channel = event.channel as string;
  const messageTs = event.ts as string;

  // Dedup: check if this exact content was captured in the last 5 minutes.
  // Guards against Slack event retries without depending on slack_ts in metadata
  // (since capture_thought controls its own metadata now).
  const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("thoughts")
    .select("id")
    .eq("content", messageText)
    .gte("created_at", recentCutoff)
    .maybeSingle();

  if (existing) {
    console.log(`Duplicate message detected for ts ${messageTs}, skipping.`);
    return;
  }

  try {
    const result = await callCaptureThought(messageText);

    if (result.isError) {
      await replyInSlack(channel, messageTs, `Failed to capture: ${result.text}`);
      return;
    }

    await replyInSlack(channel, messageTs, result.text);
  } catch (error) {
    console.error("Error capturing thought:", error);
    await replyInSlack(channel, messageTs, `Failed to capture: ${(error as Error).message}`);
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    const body = await req.json();

    // Slack URL verification handshake
    if (body.type === "url_verification") {
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const event = body.event;
    if (
      !event ||
      event.type !== "message" ||
      event.subtype ||
      event.bot_id ||
      event.channel !== SLACK_CAPTURE_CHANNEL
    ) {
      return new Response("ok", { status: 200 });
    }

    const messageText: string = event.text;
    if (!messageText || messageText.trim() === "") {
      return new Response("ok", { status: 200 });
    }

    // Acknowledge Slack immediately so it doesn't retry the event.
    // The actual processing happens async via waitUntil.
    EdgeRuntime.waitUntil(processMessage(event));
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Function error:", err);
    return new Response("error", { status: 500 });
  }
});
