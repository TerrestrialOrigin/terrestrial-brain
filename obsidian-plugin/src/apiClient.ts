// ─── MCP API client ──────────────────────────────────────────────────────────
// A narrow, injectable seam over the MCP HTTP endpoint. The plugin depends on
// the `TerrestrialBrainApiClient` interface; `HttpTerrestrialBrainClient` is the
// production implementation over `fetch`. Tests can supply a fake client, and
// the real client is exercised directly (fetch mocked at the boundary) plus in
// a Deno integration test against the live stack.

// Explicit .ts extension so this client (and its only dependency) can be
// imported directly from the Deno integration test as well as bundled by esbuild.
import { buildEndpointUrl, truncateForNotice } from "./utils.ts";

// ─── Server response shapes ──────────────────────────────────────────────────

export interface AIOutputMetadata {
  id: string;
  title: string;
  file_path: string;
  content_size: number;
  created_at: string;
}

export interface AIOutputContent {
  id: string;
  content: string;
}

// ─── Boundary type guards ────────────────────────────────────────────────────
// External data is validated here — never cast with `as`. A response that fails
// these guards is surfaced as an error rather than silently trusted.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAIOutputMetadata(value: unknown): value is AIOutputMetadata {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    typeof value.file_path === "string" &&
    typeof value.content_size === "number" &&
    typeof value.created_at === "string"
  );
}

export function isAIOutputMetadataArray(value: unknown): value is AIOutputMetadata[] {
  return Array.isArray(value) && value.every(isAIOutputMetadata);
}

export function isAIOutputContent(value: unknown): value is AIOutputContent {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && typeof value.content === "string";
}

export function isAIOutputContentArray(value: unknown): value is AIOutputContent[] {
  return Array.isArray(value) && value.every(isAIOutputContent);
}

// ─── Settings accessors ──────────────────────────────────────────────────────
// The client reads current settings through these so it always uses the latest
// endpoint/key without holding a stale copy.

export interface ApiClientSettings {
  getEndpointUrl(): string;
  getAccessKey(): string;
}

// ─── Client interface ────────────────────────────────────────────────────────

export interface TerrestrialBrainApiClient {
  /** POST to a named MCP sub-route; returns the parsed `{ success, ... }` envelope. */
  call(endpointName: string, body?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Ingest a note; returns the server's human-facing message. */
  ingestNote(content: string, title: string, noteId: string): Promise<string>;
  /** Erase a note's backend data (snapshot + thoughts); returns the server message. */
  forgetNote(noteId: string): Promise<string>;
  /** Poll pending AI output metadata, validated at the boundary. */
  fetchPendingMetadata(): Promise<AIOutputMetadata[]>;
  /** Fetch full AI output content for the given ids, validated at the boundary. */
  fetchContent(ids: string[]): Promise<AIOutputContent[]>;
}

// ─── HTTP implementation ─────────────────────────────────────────────────────

export class HttpTerrestrialBrainClient implements TerrestrialBrainApiClient {
  constructor(private readonly settings: ApiClientSettings) {}

  /** Request headers — sends the access key via x-tb-key, never in the URL. */
  private buildRequestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const accessKey = this.settings.getAccessKey();
    if (accessKey) {
      headers["x-tb-key"] = accessKey;
    }
    return headers;
  }

  /**
   * The single shared request path used by every call. Handles URL construction,
   * headers, the `response.ok` check, JSON parsing, and the `success` envelope.
   * `errorLabel` distinguishes generic calls ("HTTP") from ingest ("Ingest") in
   * thrown messages, matching the pre-refactor behavior.
   */
  private async request(
    endpointName: string,
    body: Record<string, unknown> | undefined,
    errorLabel: string,
  ): Promise<Record<string, unknown>> {
    const endpointUrl = buildEndpointUrl(this.settings.getEndpointUrl(), endpointName);

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: this.buildRequestHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      console.error(`TB ${errorLabel} ${response.status} on ${endpointName}:`, responseBody);
      throw new Error(`${errorLabel} ${response.status}: ${truncateForNotice(responseBody)}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(truncateForNotice(result.error || `Unknown ${errorLabel.toLowerCase()} error`));
    }
    return result;
  }

  async call(endpointName: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request(endpointName, body, "HTTP");
  }

  async ingestNote(content: string, title: string, noteId: string): Promise<string> {
    const result = await this.request("ingest-note", { content, title, note_id: noteId }, "Ingest");
    return typeof result.message === "string" ? result.message : "Done";
  }

  async forgetNote(noteId: string): Promise<string> {
    const result = await this.request("forget-note", { note_id: noteId }, "Forget");
    return typeof result.message === "string" ? result.message : "Done";
  }

  async fetchPendingMetadata(): Promise<AIOutputMetadata[]> {
    const result = await this.call("get-pending-ai-output-metadata");
    if (!isAIOutputMetadataArray(result.data)) {
      throw new Error("Malformed AI-output metadata response from server");
    }
    return result.data;
  }

  async fetchContent(ids: string[]): Promise<AIOutputContent[]> {
    const result = await this.call("fetch-ai-output-content", { ids });
    if (!isAIOutputContentArray(result.data)) {
      throw new Error("Malformed AI-output content response from server");
    }
    return result.data;
  }
}
