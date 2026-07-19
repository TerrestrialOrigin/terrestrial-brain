// ─── Pure utilities ──────────────────────────────────────────────────────────
// Framework-free helpers with no Obsidian dependency. Every function here is
// deterministic and unit-testable in isolation.

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * Remove a leading YAML frontmatter block. Only genuine frontmatter matches:
 * `---` as the entire first line and a closing `---` on its own line. A note
 * that merely opens with a `---` horizontal rule is left untouched (a looser
 * pattern silently truncated such notes before syncing — PLUG-12).
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "");
}

/**
 * Render a caught unknown as a message string. The shared helper for every
 * catch site, so a thrown string/object never crashes inside the catch handler.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** True when the value is a plain (non-array, non-null) object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Bound and sanitize text before showing it in a user-facing Notice.
 * Collapses whitespace and truncates to `maxLength`, so a large or malformed
 * server response body (e.g. an HTML error page or stack trace) is not shown
 * verbatim to the user. Full detail is logged to the console separately.
 */
export function truncateForNotice(text: string, maxLength = 300): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength)}…`;
}

/** The subset of Obsidian's file cache the exclusion check reads. */
export interface ExclusionCache {
  frontmatter?: Record<string, unknown> | null;
  tags?: { tag: string }[] | null;
}

/**
 * Decide whether a note is excluded from syncing, given its metadata cache and
 * the configured exclude tag. Pure so it can be unit-tested without Obsidian:
 * matches a standalone frontmatter boolean (`<tag>: true`), an inline `#tag`,
 * or a frontmatter `tags` entry (string or array), case-insensitively.
 */
export function isExcludedByCache(cache: ExclusionCache | null, excludeTag: string): boolean {
  if (!cache) return false;

  const tag = excludeTag.replace(/^#/, "");
  if (cache.frontmatter?.[tag] === true) return true;

  const tagLower = tag.toLowerCase();
  const inlineTags = cache.tags?.map((entry) => entry.tag.replace(/^#/, "").toLowerCase()) ?? [];
  const frontmatterTags = cache.frontmatter?.tags ?? [];
  const frontmatterTagList = (Array.isArray(frontmatterTags) ? frontmatterTags : [frontmatterTags])
    .map((entry: unknown) => String(entry).toLowerCase());

  return [...inlineTags, ...frontmatterTagList].includes(tagLower);
}

/**
 * djb2-style 32-bit string hash used only for change detection (has this note's
 * content changed since we last synced it?). The 32-bit width means collisions
 * are theoretically possible, but the consequence of one is merely a missed
 * re-sync of a single note — never data loss — so the trade-off is accepted here
 * in favour of a tiny, dependency-free, synchronous hash. Do NOT reuse this for
 * anything security- or integrity-sensitive.
 */
export function simpleHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const charCode = input.charCodeAt(i);
    hash = (hash << 5) - hash + charCode;
    hash |= 0;
  }
  return String(hash);
}

/** Milliseconds in one minute — used to convert minute-based settings to ms. */
export const MS_PER_MINUTE = 60000;

/**
 * Given the MCP endpoint URL (e.g. "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc"),
 * construct a named sub-route URL by inserting "/<endpointName>" before the query string.
 */
export function buildEndpointUrl(tbEndpointUrl: string, endpointName: string): string {
  const questionMarkIndex = tbEndpointUrl.indexOf("?");
  if (questionMarkIndex === -1) {
    return `${tbEndpointUrl}/${endpointName}`;
  }
  const basePath = tbEndpointUrl.substring(0, questionMarkIndex);
  const queryString = tbEndpointUrl.substring(questionMarkIndex);
  return `${basePath}/${endpointName}${queryString}`;
}

/**
 * Extract a legacy `key` query parameter from an endpoint URL.
 * Returns the URL without the `key` parameter (dropping the `?` entirely when
 * no other parameters remain) and the extracted key (`""` when none present).
 * String-based on purpose: the value may be a partial URL while the user is
 * typing, which `new URL()` would throw on.
 */
export function extractKeyFromUrl(endpointUrl: string): { url: string; key: string } {
  const questionMarkIndex = endpointUrl.indexOf("?");
  if (questionMarkIndex === -1) {
    return { url: endpointUrl, key: "" };
  }
  const basePath = endpointUrl.substring(0, questionMarkIndex);
  const params = endpointUrl.substring(questionMarkIndex + 1).split("&");
  const remainingParams: string[] = [];
  let extractedKey = "";
  for (const param of params) {
    if (param.startsWith("key=")) {
      extractedKey = decodeURIComponent(param.substring("key=".length));
    } else if (param.length > 0) {
      remainingParams.push(param);
    }
  }
  const strippedUrl = remainingParams.length > 0
    ? `${basePath}?${remainingParams.join("&")}`
    : basePath;
  return { url: strippedUrl, key: extractedKey };
}

/**
 * True when the endpoint sends traffic in cleartext to a non-local host —
 * plain http:// anywhere except localhost / 127.0.0.1.
 */
export function isInsecureEndpoint(endpointUrl: string): boolean {
  if (!endpointUrl.toLowerCase().startsWith("http://")) {
    return false;
  }
  const withoutScheme = endpointUrl.substring("http://".length);
  const hostWithPort = withoutScheme.split(/[/?#]/)[0] ?? "";
  const host = (hostWithPort.split(":")[0] ?? "").toLowerCase();
  return host !== "localhost" && host !== "127.0.0.1";
}

/**
 * Given a vault-relative path that already exists, find the first available
 * copy name using the pattern `Filename(N).md` starting at N=2.
 * The `existsCheck` parameter is injected for testability.
 */
export async function generateCopyPath(
  originalPath: string,
  existsCheck: (path: string) => Promise<boolean>,
): Promise<string> {
  const lastSlash = originalPath.lastIndexOf("/");
  const directory = lastSlash >= 0 ? originalPath.substring(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? originalPath.substring(lastSlash + 1) : originalPath;

  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  const extension = dotIndex >= 0 ? filename.substring(dotIndex) : "";

  const maxAttempts = 100;
  for (let suffix = 2; suffix <= maxAttempts + 1; suffix++) {
    const candidate = `${directory}${stem}(${suffix})${extension}`;
    if (!(await existsCheck(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not find available copy name for "${originalPath}" after ${maxAttempts} attempts`);
}
