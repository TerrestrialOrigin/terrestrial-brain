/**
 * Filepath validation for AI output — ensures cross-platform compatibility
 * by validating against Windows (most restrictive OS) rules.
 *
 * Returns null if valid, or a descriptive error string if invalid.
 */

const INVALID_PATH_CHARACTERS = /[<>:"\\\|?*]/;
const CONTROL_CHARACTERS = /[\x00-\x1F]/;
const RESERVED_WINDOWS_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

export function validateFilePath(filePath: string): string | null {
  if (!filePath || !filePath.trim()) {
    return "Invalid file path: path must not be empty.";
  }

  if (filePath.startsWith("/")) {
    return "Invalid file path: path must be vault-relative (no leading slash).";
  }

  if (filePath.includes("//")) {
    return "Invalid file path: path contains empty segments (consecutive slashes).";
  }

  if (!filePath.endsWith(".md")) {
    return "Invalid file path: file must have a .md extension.";
  }

  const segments = filePath.split("/");

  for (const segment of segments) {
    if (!segment) {
      return "Invalid file path: path contains empty segments (consecutive slashes).";
    }

    const controlMatch = segment.match(CONTROL_CHARACTERS);
    if (controlMatch) {
      const charCode = controlMatch[0].charCodeAt(0);
      return `Invalid file path: character U+${charCode.toString(16).padStart(4, "0").toUpperCase()} (control character) is not allowed in file or folder names.`;
    }

    const invalidCharMatch = segment.match(INVALID_PATH_CHARACTERS);
    if (invalidCharMatch) {
      return `Invalid file path: character '${invalidCharMatch[0]}' is not allowed in file or folder names. Please use only letters, numbers, spaces, hyphens, underscores, and periods.`;
    }

    if (segment.endsWith(".") || segment.endsWith(" ")) {
      return "Invalid file path: file and folder names must not end with a period or space.";
    }

    // Check reserved names: strip extension for comparison
    const nameWithoutExtension = segment.replace(/\.[^.]+$/, "");
    if (RESERVED_WINDOWS_NAMES.has(nameWithoutExtension.toUpperCase())) {
      return `Invalid file path: '${segment}' is a reserved filename on Windows. Please choose a different name.`;
    }
  }

  return null;
}
