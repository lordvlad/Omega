/**
 * Git status inspection for workspaces.
 *
 * Runs `git status` in porcelain mode to extract the active branch and any
 * modified, untracked, added, deleted, or conflicted files.
 */
import * as path from "node:path";

import type { GitFileStatus, GitStatusResult } from "../shared/model.ts";

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
