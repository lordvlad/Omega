/**
 * Workspace file listing.
 *
 * Scans files in a workspace directory while skipping common build, dependency,
 * and version control directories. Used by the command palette to offer `@`
 * fuzzy file completions.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type {
  BrowseDirectoryQuery,
  DirectoryBrowseResult,
  DirectoryEntry,
  ReadFileResult,
} from "../shared/model.ts";
import { getGitStatus } from "./git.ts";

const IGNORED_DIRS: Record<string, true> = {
  ".git": true,
  node_modules: true,
  dist: true,
  build: true,
  ".next": true,
  ".turbo": true,
  ".cache": true,
  ".output": true,
  coverage: true,
  ".venv": true,
  venv: true,
  __pycache__: true,
  ".svn": true,
  ".hg": true,
};

/**
 * Recursively list files in `cwd`, returning POSIX-style relative paths.
 */
export async function listFiles(cwd?: string, maxFiles = 10000): Promise<string[]> {
  const root = path.resolve(cwd || process.cwd());
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }

  const result: string[] = [];
  async function walk(dir: string, rel: string) {
    if (result.length >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.length >= maxFiles) break;
      const name = entry.name;
      const relPath = rel ? `${rel}/${name}` : name;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS[name]) continue;
        await walk(path.join(dir, name), relPath);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        result.push(relPath);
      }
    }
  }

  await walk(root, "");
  result.sort((a, b) => a.localeCompare(b));
  return result;
}

/** Image file extensions recognized for data URL image preview. */
const IMAGE_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
};

/** Common text MIME types based on file extension. */
const TEXT_MIME_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".ts": "text/typescript",
  ".tsx": "text/typescript-jsx",
  ".jsx": "text/javascript-jsx",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".toml": "text/toml",
};

/** Default largest file size (500 KB) rendered inline as text/syntax-highlighted code. */
export const DEFAULT_MAX_PREVIEW_BYTES = 500_000;
export const MAX_PREVIEW_BYTES = Number(
  process.env.OMEGA_MAX_PREVIEW_BYTES ?? process.env.MAX_PREVIEW_BYTES ?? DEFAULT_MAX_PREVIEW_BYTES,
);

/**
 * Read the content and metadata of a file within the workspace.
 */
export async function readFileContent(
  relPath: string,
  cwd?: string,
  maxPreviewBytes: number = MAX_PREVIEW_BYTES,
): Promise<ReadFileResult> {
  const root = path.resolve(cwd || process.cwd());
  const fullPath = path.resolve(root, relPath);

  // A bare prefix match would accept a sibling directory whose name merely
  // starts with the root's — `/work-secrets` passes `startsWith("/work")`.
  // Compare against the root plus its separator, and allow the root itself.
  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error("Path is outside workspace directory.");
  }

  const stat = await fs.stat(fullPath);
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new Error("Target is not a readable file.");
  }

  const ext = path.extname(relPath).toLowerCase();
  const imageMime = IMAGE_EXTENSIONS[ext];

  if (imageMime) {
    const buffer = await fs.readFile(fullPath);
    return {
      path: relPath,
      size: stat.size,
      mimeType: imageMime,
      isBinary: true,
      isImage: true,
      dataUrl: `data:${imageMime};base64,${buffer.toString("base64")}`,
    };
  }
  const mimeType = TEXT_MIME_TYPES[ext] ?? "text/plain";

  // Files larger than maxPreviewBytes are not read into memory as strings to keep
  // wire payloads lightweight and avoid freezing browser syntax highlighters.
  if (stat.size > maxPreviewBytes) {
    return {
      path: relPath,
      size: stat.size,
      mimeType,
      isBinary: false,
      isImage: false,
      isTooLarge: true,
    };
  }

  const content = await fs.readFile(fullPath, "utf-8");

  return {
    path: relPath,
    size: stat.size,
    mimeType,
    isBinary: false,
    isImage: ext === ".svg",
    content,
  };
}

/**
 * Resolve and validate a workspace file for raw download streaming.
 */
export async function resolveDownloadPath(
  relPath: string,
  cwd?: string,
): Promise<{ fullPath: string; fileName: string; size: number; mimeType: string }> {
  const root = path.resolve(cwd || process.cwd());
  const fullPath = path.resolve(root, relPath);

  const rel = path.relative(root, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path is outside workspace directory.");
  }

  const stat = await fs.stat(fullPath);
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new Error("Target is not a downloadable file.");
  }

  const ext = path.extname(relPath).toLowerCase();
  const mimeType = IMAGE_EXTENSIONS[ext] ?? TEXT_MIME_TYPES[ext] ?? "application/octet-stream";

  return {
    fullPath,
    fileName: path.basename(relPath),
    size: stat.size,
    mimeType,
  };
}
/**
 * Browse filesystem directories for interactive directory selection.
 */
export async function browseDirectory(query?: BrowseDirectoryQuery): Promise<DirectoryBrowseResult> {
  const home = os.homedir();
  const rawPath = query?.path?.trim();
  let target = rawPath
    ? rawPath.startsWith("~")
      ? path.join(home, rawPath.replace(/^~[/\\]?/, ""))
      : path.resolve(rawPath)
    : process.cwd();

  try {
    const stat = await fs.stat(target);
    if (!stat.isDirectory()) {
      target = path.dirname(target);
    }
  } catch {
    try {
      const parent = path.dirname(target);
      const parentStat = await fs.stat(parent);
      if (parentStat.isDirectory()) {
        target = parent;
      } else {
        target = process.cwd();
      }
    } catch {
      target = process.cwd();
    }
  }

  const parent = target === path.dirname(target) ? undefined : path.dirname(target);

  let isGit = false;
  let gitBranch: string | undefined;
  try {
    const git = await getGitStatus(target);
    if (git.branch) {
      isGit = true;
      gitBranch = git.branch;
    }
  } catch {
    // Ignore git status errors when inspecting arbitrary filesystem directories
  }

  const entries: DirectoryEntry[] = [];
  try {
    const rawEntries = await fs.readdir(target, { withFileTypes: true });
    for (const entry of rawEntries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const name = entry.name;
      if (!query?.showHidden && name.startsWith(".")) continue;
      if (name === ".git" || name === "node_modules" || name === ".venv" || name === "venv") continue;

      const fullPath = path.join(target, name);
      let isEntryGit = false;
      let hasChildren = false;

      try {
        const sub = await fs.readdir(fullPath, { withFileTypes: true });
        isEntryGit = sub.some(s => s.name === ".git");
        hasChildren = sub.some(s => s.isDirectory());
      } catch {
        // Permission denied or unreadable subdirectory
      }

      entries.push({
        name,
        path: fullPath,
        isGit: isEntryGit,
        hasChildren,
      });
    }
  } catch (error) {
    return {
      current: target,
      parent,
      home,
      entries: [],
      isGit,
      gitBranch,
      exists: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return {
    current: target,
    parent,
    home,
    entries,
    isGit,
    gitBranch,
    exists: true,
  };
}
