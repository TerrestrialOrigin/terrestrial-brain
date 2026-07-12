// Deterministic docs-consistency guard for the branding-separation change
// (New-Feature-Plan Step 3). Ensures the product's public marketing surfaces
// describe Terrestrial Brain on its own terms, with third-party (Open Brain /
// OB1 / Nate B. Jones) provenance confined to NOTICE.md and the README License
// section. Reads repo files directly, so the `test` task grants --allow-read.

import { assert, assertEquals } from "@std/assert";

const repoRoot = await Deno.realPath(`${import.meta.dirname}/../..`);

// Word-boundary patterns so common substrings ("halluciNATEd", "origiNATEd",
// "coordiNATE") do NOT false-positive; "open.?brain" is specific enough on its own.
const BRANDING_PATTERNS = [/open[\s-]?brain/i, /\bOB1\b/i, /\bNate\b/i];

// Marketing surfaces where provenance branding must NOT appear are scanned in
// full EXCEPT these paths, which legitimately retain attribution or history:
//   - NOTICE.md, LICENSE.md: required third-party attribution / license text
//   - ThreatModel.md: factual design + compliance notes
//   - supabase/migrations/: append-only history comments (never edited)
//   - codeEval/, openspec/: planning docs and archived change records
//   - tests/: this guard's own pattern strings
//   - .claude/: local agent skill/command docs (not shipped product copy)
const ALLOWLISTED_PATH_PREFIXES = [
  "NOTICE.md",
  "LICENSE.md",
  "ThreatModel.md",
  "supabase/migrations/",
  "codeEval/",
  "openspec/",
  "tests/",
  ".claude/",
];

const EXCLUDED_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  ".obsidian",
]);

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".sql",
  ".sh",
  ".yaml",
  ".yml",
  ".txt",
  ".html",
  ".css",
  ".toml",
]);

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function isAllowlisted(relativePath: string): boolean {
  return ALLOWLISTED_PATH_PREFIXES.some((prefix) =>
    relativePath.startsWith(prefix)
  );
}

async function collectTextFiles(
  directory: string,
  into: string[],
): Promise<void> {
  for await (const entry of Deno.readDir(directory)) {
    const fullPath = `${directory}/${entry.name}`;
    if (entry.isDirectory) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      await collectTextFiles(fullPath, into);
    } else if (entry.isFile && TEXT_EXTENSIONS.has(extensionOf(entry.name))) {
      into.push(fullPath);
    }
  }
}

function readmeLicenseHeadingIndex(lines: string[]): number {
  return lines.findIndex((line) => /^##\s+License\b/i.test(line));
}

function firstTaglineUnderHeading(lines: string[]): string {
  const headingIndex = lines.findIndex((line) =>
    /^#\s+Terrestrial Brain\s*$/.test(line)
  );
  assert(
    headingIndex !== -1,
    "README.md must start with a '# Terrestrial Brain' heading",
  );
  for (let index = headingIndex + 1; index < lines.length; index++) {
    if (lines[index].trim() !== "") return lines[index];
  }
  return "";
}

Deno.test("branding: README tagline describes the product without provenance", async () => {
  const tagline = firstTaglineUnderHeading(
    (await Deno.readTextFile(`${repoRoot}/README.md`)).split("\n"),
  );
  for (const pattern of BRANDING_PATTERNS) {
    assert(
      !pattern.test(tagline),
      `README tagline must not reference Open Brain / OB1 / Nate — matched ${pattern}: "${tagline}"`,
    );
  }
  assert(
    !/subscribe|youtube/i.test(tagline),
    `README tagline must not contain third-party endorsement copy: "${tagline}"`,
  );
});

Deno.test("branding: NOTICE.md retains the MIT-era attribution", async () => {
  const notice = await Deno.readTextFile(`${repoRoot}/NOTICE.md`);
  assert(
    notice.includes("Nate B. Jones"),
    "NOTICE.md must retain the Nate B. Jones attribution",
  );
});

Deno.test("branding: no provenance branding in marketing copy outside the allowlist", async () => {
  const files: string[] = [];
  await collectTextFiles(repoRoot, files);

  const offenders: string[] = [];
  for (const fullPath of files) {
    const relativePath = fullPath.slice(repoRoot.length + 1);
    if (isAllowlisted(relativePath)) continue;

    const lines = (await Deno.readTextFile(fullPath)).split("\n");
    const licenseIndex = relativePath === "README.md"
      ? readmeLicenseHeadingIndex(lines)
      : -1;

    for (let index = 0; index < lines.length; index++) {
      // README License section legitimately points at NOTICE.md attribution.
      if (licenseIndex !== -1 && index >= licenseIndex) continue;
      const line = lines[index];
      if (BRANDING_PATTERNS.some((pattern) => pattern.test(line))) {
        offenders.push(`${relativePath}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    offenders,
    [],
    `Provenance branding found in marketing copy (move attribution to NOTICE.md):\n${
      offenders.join("\n")
    }`,
  );
});
