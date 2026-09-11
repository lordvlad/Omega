/**
 * Workspace and session listing.
 *
 * omp groups session files into one directory per working directory, but the
 * directory names are an encoding of the path that has changed shape over
 * time (`-tmp` and `--data-workspace2--` both exist on this machine). So the
 * grouping key is the `cwd` recorded inside each session header, which
 * `SessionManager.listAll()` already reads, rather than a decoded filename.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { SessionManager } from "@oh-my-pi/pi-coding-agent";

import type { SessionStatus, SessionSummary, Workspace } from "../shared/model.ts";

/** Longest session preview kept in a listing payload. */
const PREVIEW_LIMIT = 200;

function preview(text: string): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  return collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT)}…` : collapsed;
}

/**
 * Exact message counts, which the listing omp hands us cannot provide.
 *
 * `SessionManager.listAll()` reads a 4 KB prefix and a 32 KB suffix of each
 * file and counts the message entries it happens to see, so every session
 * past about 36 KB reports the same handful — every session on this machine
 * listed "4 msg" regardless of length, which is worse than no number at all.
 *
 * Counting properly means reading the files, so the result is cached against
 * each file's size and mtime, and a session that has only grown is resumed
 * from where the last count stopped rather than re-read. Session files are
 * append-only and reach tens of megabytes, so the alternative is re-reading
 * the open conversation on every poll of the session list.
 */
interface CountedFile {
  mtimeMs: number;
  /** Bytes counted so far, and the resume point for an append. */
  size: number;
  count: number;
  /** Whether the counted region ended cleanly, so an append starts a line. */
  aligned: boolean;
}

const counted = new Map<string, CountedFile>();

/** Every entry writes `type` first, so a message line starts with this. */
const MESSAGE_LINE = new TextEncoder().encode('{"type":"message"');
const NEWLINE = 0x0a;

/**
 * Count message entries in a byte range, matching only at the start of a
 * line.
 *
 * Anchoring matters rather than being pedantic: these transcripts are full of
 * agents discussing session files, so the literal `{"type":"message"` appears
 * inside message content. A substring scan counts those too.
 */
async function countRange(file: string, from: number): Promise<{ count: number; aligned: boolean }> {
  let count = 0;
  /** True while the current line could still be a message entry. */
  let matching = true;
  let matched = 0;
  let last = NEWLINE;

  const slice = from > 0 ? Bun.file(file).slice(from) : Bun.file(file);
  for await (const chunk of slice.stream()) {
    for (const byte of chunk) {
      last = byte;
      if (byte === NEWLINE) {
        matching = true;
        matched = 0;
        continue;
      }
      if (!matching) continue;
      if (byte === MESSAGE_LINE[matched]) {
        matched += 1;
        if (matched === MESSAGE_LINE.length) {
          count += 1;
          matching = false;
        }
      } else {
        matching = false;
      }
    }
  }

  return { count, aligned: last === NEWLINE };
}

/** Messages in one session file, reusing or extending the cached count. */
async function messageCount(file: string, size: number, mtimeMs: number, fallback: number): Promise<number> {
  const cached = counted.get(file);
  if (cached && cached.size === size && cached.mtimeMs === mtimeMs) return cached.count;

  try {
    // Only an append can be resumed. A file that shrank or was rewritten in
    // place - a discarded entry, a rewritten header - is counted again.
    const resume = cached?.aligned === true && size > cached.size;
    const from = resume ? cached.size : 0;
    const { count, aligned } = await countRange(file, from);
    const total = resume ? cached.count + count : count;
    counted.set(file, { mtimeMs, size, count: total, aligned });
    return total;
  } catch {
    // Deleted or unreadable between listing and counting: omp's sampled count
    // is wrong but harmless, and the session disappears from the next listing.
    return fallback;
  }
}

/**
 * Every directory with at least one session on disk, newest first, each with
 * its own sessions newest first.
 *
 * `isLive` decides the `live` flag; the registry owns that knowledge, so it is
 * injected rather than imported to keep this module free of session state.
 */
export async function listWorkspaces(isLive: (sessionId: string) => boolean): Promise<Workspace[]> {
  const sessions = await SessionManager.listAll();
  const groups = new Map<string, SessionSummary[]>();

  // Counted together rather than per session: all but the open conversation
  // are cache hits, and the first listing of a cold process is the one case
  // where there is real reading to overlap.
  const counts = await Promise.all(
    sessions.map(info => messageCount(info.path, info.size, info.modified.getTime(), info.messageCount)),
  );

  // A session deleted on disk must not keep its entry alive for the life of
  // the process.
  const seen = new Set(sessions.map(info => info.path));
  for (const file of counted.keys()) {
    if (!seen.has(file)) counted.delete(file);
  }

  for (const [index, info] of sessions.entries()) {
    // Sessions written before omp recorded a cwd carry an empty string. They
    // are real sessions, so they get a real group rather than being dropped.
    const cwd = info.cwd || "(unknown)";
    const summary: SessionSummary = {
      path: info.path,
      id: info.id,
      cwd,
      title: info.title,
      created: info.created.toISOString(),
      modified: info.modified.toISOString(),
      messageCount: counts[index] ?? info.messageCount,
      size: info.size,
      firstMessage: preview(info.firstMessage ?? ""),
      status: (info.status ?? "unknown") as SessionStatus,
      live: isLive(info.id),
    };
    const bucket = groups.get(cwd);
    if (bucket) bucket.push(summary);
    else groups.set(cwd, [summary]);
  }

  const workspaces: Workspace[] = [];
  for (const [cwd, group] of groups) {
    group.sort((a, b) => b.modified.localeCompare(a.modified));
    workspaces.push({
      cwd,
      name: path.basename(cwd) || cwd,
      sessions: group,
      // `group` is sorted, so the first entry is the newest.
      modified: group[0]?.modified ?? new Date(0).toISOString(),
      exists: cwd !== "(unknown)" && fs.existsSync(cwd),
    });
  }

  workspaces.sort((a, b) => b.modified.localeCompare(a.modified));
  return workspaces;
}
