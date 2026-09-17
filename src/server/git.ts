/**
 * Git status inspection for workspaces.
 *
 * Runs `git status` in porcelain mode to extract the active branch and any
 * modified, untracked, added, deleted, or conflicted files.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { GitDiffResult, GitFileStatus, GitStatusResult } from "../shared/model.ts";

/**
 * Read the git status of a workspace directory.
 *
 * Resolves cleanly even when `cwd` is not a git repository or git is not
 * installed, returning a clean status without throwing.
 */
export async function getGitStatus(cwd?: string): Promise<GitStatusResult> {
  const root = path.resolve(cwd || process.cwd());

  try {
    const proc = Bun.spawn(["git", "status", "--porcelain=v1", "-b", "-uall"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

    if (exitCode !== 0) {
      return { clean: true, files: {} };
    }

    return parseGitStatusOutput(stdout);
  } catch {
    return { clean: true, files: {} };
  }
}
/** Largest diff size (500 KB) rendered inline as syntax-highlighted diff. */
const MAX_DIFF_BYTES = 500_000;

/**
 * Read the git diff of a specific file in a workspace directory.
 *
 * Returns unified diff between HEAD and working tree (including staged + unstaged changes),
 * or untracked additions.
 */
export async function getGitDiff(relPath: string, cwd?: string): Promise<GitDiffResult> {
  const root = path.resolve(cwd || process.cwd());
  const fullPath = path.resolve(root, relPath);

  if (fullPath !== root && !fullPath.startsWith(root + path.sep)) {
    throw new Error("Path is outside workspace directory.");
  }

  try {
    const isRepoProc = Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [isRepoText, isRepoExit] = await Promise.all([
      new Response(isRepoProc.stdout).text(),
      isRepoProc.exited,
    ]);
    if (isRepoExit !== 0 || isRepoText.trim() !== "true") {
      return { path: relPath, diff: "", hasDiff: false };
    }

    const revProc = Bun.spawn(["git", "rev-parse", "--verify", "HEAD"], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    const hasHead = (await revProc.exited) === 0;

    const diffArgs = hasHead ? ["git", "diff", "HEAD", "--", relPath] : ["git", "diff", "--", relPath];
    const diffProc = Bun.spawn(diffArgs, {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    let diffText = await new Response(diffProc.stdout).text();
    await diffProc.exited;

    // If empty diff, check for untracked file
    if (!diffText.trim()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile() || stat.isSymbolicLink()) {
          const noIndexProc = Bun.spawn(["git", "diff", "--no-index", "--", "/dev/null", fullPath], {
            cwd: root,
            stdout: "pipe",
            stderr: "pipe",
          });
          const untrackedDiff = await new Response(noIndexProc.stdout).text();
          await noIndexProc.exited;
          if (untrackedDiff.trim()) {
            diffText = untrackedDiff;
          }
        }
      } catch {
        // File may be deleted or unreadable
      }
    }

    const diffSize = Buffer.byteLength(diffText, "utf-8");
    const isBinary = diffText.includes("Binary files") || diffText.includes("GIT binary patch");
    const isTooLarge = diffSize > MAX_DIFF_BYTES;

    return {
      path: relPath,
      diff: isTooLarge ? "" : diffText,
      hasDiff: diffText.trim().length > 0,
      isBinary,
      isTooLarge,
      size: diffSize,
    };
  } catch {
    return {
      path: relPath,
      diff: "",
      hasDiff: false,
    };
  }
}

/**
 * Parse `git status --porcelain=v1 -b -uall` output into a structured status object.
 */
export function parseGitStatusOutput(output: string): GitStatusResult {
  let branch: string | undefined;
  const files: Record<string, GitFileStatus> = {};

  const lines = output.split("\n");
  for (const line of lines) {
    if (!line) continue;

    if (line.startsWith("## ")) {
      branch = parseBranchHeader(line.slice(3).trim());
      continue;
    }

    if (line.length < 4) continue;

    const x = line[0] ?? " ";
    const y = line[1] ?? " ";
    let rawPath = line.slice(3).trim();

    // Git quotes paths containing spaces or non-ASCII characters
    if (rawPath.startsWith('"') && rawPath.endsWith('"')) {
      try {
        rawPath = JSON.parse(rawPath);
      } catch {
        rawPath = rawPath.slice(1, -1);
      }
    }

    let origPath: string | undefined;
    if (rawPath.includes(" -> ")) {
      const parts = rawPath.split(" -> ");
      origPath = parts[0]?.replace(/\\/gu, "/").replace(/^\.\//u, "");
      rawPath = parts[1] ?? rawPath;
    }

    const normPath = rawPath.replace(/\\/gu, "/").replace(/^\.\//u, "");
    const { status, marker, staged, unstaged } = classifyGitStatus(x, y);

    files[normPath] = {
      path: normPath,
      origPath,
      status,
      marker,
      staged,
      unstaged,
    };
  }

  return {
    branch,
    clean: Object.keys(files).length === 0,
    files,
  };
}

/** Extract branch name from the `## ` header line. */
function parseBranchHeader(header: string): string | undefined {
  if (header.startsWith("HEAD (no branch)")) {
    return "(detached)";
  }
  if (header.startsWith("Initial commit on ") || header.startsWith("No commits yet on ")) {
    return header.split(" ").pop();
  }
  // format: `<branch>...<upstream> [ahead N, behind M]` or `<branch>`
  const branchPart = header.split("...")[0]?.split(" ")[0];
  return branchPart || undefined;
}

/** Classify porcelain X and Y status codes. */
function classifyGitStatus(
  x: string,
  y: string,
): {
  status: GitFileStatus["status"];
  marker: string;
  staged: boolean;
  unstaged: boolean;
} {
  const code = `${x}${y}`;

  if (code === "??") {
    return { status: "untracked", marker: "U", staged: false, unstaged: true };
  }
  if (code === "!!") {
    return { status: "ignored", marker: "I", staged: false, unstaged: false };
  }

  // Conflicts (unmerged paths)
  if (code === "UU" || code === "AA" || code === "DD" || x === "U" || y === "U") {
    return { status: "conflict", marker: "!", staged: true, unstaged: true };
  }

  const staged = x !== " " && x !== "?" && x !== "!";
  const unstaged = y !== " " && y !== "?" && y !== "!";

  if (x === "A" || (y === "A" && !staged)) {
    return { status: "added", marker: "A", staged, unstaged };
  }
  if (x === "D" || y === "D") {
    return { status: "deleted", marker: "D", staged, unstaged };
  }
  if (x === "R" || y === "R") {
    return { status: "renamed", marker: "R", staged, unstaged };
  }
  if (x === "C" || y === "C") {
    return { status: "copied", marker: "C", staged, unstaged };
  }

  // Modified (default for changes)
  return { status: "modified", marker: "M", staged, unstaged };
}
