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
 * Every directory with at least one session on disk, newest first, each with
 * its own sessions newest first.
 *
 * `isLive` decides the `live` flag; the registry owns that knowledge, so it is
 * injected rather than imported to keep this module free of session state.
 */
export async function listWorkspaces(isLive: (sessionId: string) => boolean): Promise<Workspace[]> {
  const sessions = await SessionManager.listAll();
  const groups = new Map<string, SessionSummary[]>();

  for (const info of sessions) {
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
      messageCount: info.messageCount,
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
