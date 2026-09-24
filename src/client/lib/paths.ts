/**
 * Cross-platform path helpers for the client (supporting POSIX and Windows paths).
 */

/** Extract the base file or folder name from a path. */
export function getBasename(filePath?: string): string {
  if (!filePath) return "";
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? filePath;
}

/** Extract the directory path containing a file or folder. */
export function getDirname(filePath?: string): string {
  if (!filePath) return "";
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return "";
  if (idx === 0) return "/";
  return normalized.slice(0, idx);
}

/** Normalize all backslashes in a path to forward slashes. */
export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}
