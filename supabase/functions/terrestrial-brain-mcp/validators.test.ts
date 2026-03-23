import { describe, it, expect } from "vitest";
import { validateFilePath } from "./validators";

// ─── Valid paths ───────────────────────────────────────────────────────────────

describe("validateFilePath — valid paths", () => {
  it("accepts simple valid path", () => {
    expect(validateFilePath("projects/MyProject/notes.md")).toBeNull();
  });

  it("accepts deeply nested valid path", () => {
    expect(validateFilePath("projects/TeamA/2026/Q1/sprint-review.md")).toBeNull();
  });

  it("accepts root-level file", () => {
    expect(validateFilePath("notes.md")).toBeNull();
  });

  it("accepts path with spaces, hyphens, underscores", () => {
    expect(validateFilePath("my folder/sub-dir/file_name.md")).toBeNull();
  });
});

// ─── Invalid characters ────────────────────────────────────────────────────────

describe("validateFilePath — invalid characters", () => {
  it("rejects path with < character", () => {
    const result = validateFilePath("projects/<bad>/file.md");
    expect(result).toContain("'<'");
  });

  it("rejects path with > character", () => {
    const result = validateFilePath("projects/bad>/file.md");
    expect(result).toContain("'>'");
  });

  it("rejects path with : character", () => {
    const result = validateFilePath("projects/bad:name/file.md");
    expect(result).toContain("':'");
  });

  it('rejects path with " character', () => {
    const result = validateFilePath('projects/bad"name/file.md');
    expect(result).toContain("'\"'");
  });

  it("rejects path with \\ character", () => {
    const result = validateFilePath("projects/bad\\name/file.md");
    expect(result).toContain("'\\'");
  });

  it("rejects path with | character", () => {
    const result = validateFilePath("projects/bad|name/file.md");
    expect(result).toContain("'|'");
  });

  it("rejects path with ? character", () => {
    const result = validateFilePath("projects/bad?name/file.md");
    expect(result).toContain("'?'");
  });

  it("rejects path with * character", () => {
    const result = validateFilePath("projects/bad*name/file.md");
    expect(result).toContain("'*'");
  });
});

// ─── Control characters ────────────────────────────────────────────────────────

describe("validateFilePath — control characters", () => {
  it("rejects path with null byte", () => {
    const result = validateFilePath("projects/bad\x00name/file.md");
    expect(result).toContain("control character");
  });

  it("rejects path with tab character", () => {
    const result = validateFilePath("projects/bad\tname/file.md");
    expect(result).toContain("control character");
  });
});

// ─── Reserved Windows names ────────────────────────────────────────────────────

describe("validateFilePath — reserved Windows names", () => {
  it("rejects CON as filename", () => {
    const result = validateFilePath("projects/CON.md");
    expect(result).toContain("reserved filename");
  });

  it("rejects con (lowercase) as filename", () => {
    const result = validateFilePath("projects/con.md");
    expect(result).toContain("reserved filename");
  });

  it("rejects PRN as filename", () => {
    const result = validateFilePath("projects/PRN.md");
    expect(result).toContain("reserved filename");
  });

  it("rejects NUL as filename", () => {
    const result = validateFilePath("projects/NUL.md");
    expect(result).toContain("reserved filename");
  });

  it("rejects COM1 as filename", () => {
    const result = validateFilePath("projects/COM1.md");
    expect(result).toContain("reserved filename");
  });

  it("rejects LPT1 as filename", () => {
    const result = validateFilePath("projects/LPT1.md");
    expect(result).toContain("reserved filename");
  });

  it("rejects AUX as folder name", () => {
    const result = validateFilePath("AUX/file.md");
    expect(result).toContain("reserved filename");
  });
});

// ─── Trailing dot/space ────────────────────────────────────────────────────────

describe("validateFilePath — trailing dot/space", () => {
  it("rejects segment ending with period", () => {
    const result = validateFilePath("projects/bad./file.md");
    expect(result).toContain("must not end with a period or space");
  });

  it("rejects segment ending with space", () => {
    const result = validateFilePath("projects/bad /file.md");
    expect(result).toContain("must not end with a period or space");
  });
});

// ─── Empty / whitespace paths ──────────────────────────────────────────────────

describe("validateFilePath — empty/whitespace", () => {
  it("rejects empty path", () => {
    expect(validateFilePath("")).toBe("Invalid file path: path must not be empty.");
  });

  it("rejects whitespace-only path", () => {
    expect(validateFilePath("   ")).toBe("Invalid file path: path must not be empty.");
  });
});

// ─── Absolute paths ────────────────────────────────────────────────────────────

describe("validateFilePath — absolute paths", () => {
  it("rejects absolute path", () => {
    expect(validateFilePath("/projects/file.md")).toBe(
      "Invalid file path: path must be vault-relative (no leading slash)."
    );
  });
});

// ─── Empty segments ────────────────────────────────────────────────────────────

describe("validateFilePath — empty segments", () => {
  it("rejects consecutive slashes", () => {
    expect(validateFilePath("projects//file.md")).toBe(
      "Invalid file path: path contains empty segments (consecutive slashes)."
    );
  });
});

// ─── Extension check ───────────────────────────────────────────────────────────

describe("validateFilePath — extension", () => {
  it("rejects file without .md extension", () => {
    expect(validateFilePath("projects/file.txt")).toBe(
      "Invalid file path: file must have a .md extension."
    );
  });

  it("rejects file with no extension", () => {
    expect(validateFilePath("projects/file")).toBe(
      "Invalid file path: file must have a .md extension."
    );
  });
});
