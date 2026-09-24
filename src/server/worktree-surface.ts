/**
 * Worktree manager A2UI surface: /wt -> "session-wt".
 *
 * Inspects and displays git worktrees across the active repository
 * and agent-managed task isolation directories under `~/.omp/wt/`.
 */
import * as path from "node:path";

import { addWorktree, listWorktrees } from "@oh-my-pi/pi-coding-agent/cli/worktree-cli";
import * as vcs from "@oh-my-pi/pi-natives/vcs";

import { WT_SURFACE_ID, type A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  kind: "main" | "linked" | "task-isolation" | "pr-checkout" | "orphan";
  isCurrent: boolean;
  clean?: boolean;
}

/**
 * Discover git worktrees in the current repo and agent worktrees.
 */
export async function discoverWorktrees(projectCwd: string): Promise<WorktreeInfo[]> {
  const result: WorktreeInfo[] = [];
  const normalizedProject = path.resolve(projectCwd);

  // 1. Query git worktrees in current repository
  try {
    const git = vcs.requireGit(normalizedProject);
    const rawList = await git.worktrees();
    if (Array.isArray(rawList)) {
      for (const wt of rawList) {
        const wtPath = path.resolve(wt.path);
        const isCurrent = wtPath === normalizedProject;
        const branch = wt.branch
          ? wt.branch.replace(/^refs\/heads\//, "")
          : wt.head
            ? wt.head.slice(0, 8)
            : "detached";
        result.push({
          path: wtPath,
          branch,
          head: wt.head ? wt.head.slice(0, 8) : "HEAD",
          kind: isCurrent ? "main" : "linked",
          isCurrent,
        });
      }
    }
  } catch {
    // Fallback if git worktreeList throws
    result.push({
      path: normalizedProject,
      branch: "main",
      head: "HEAD",
      kind: "main",
      isCurrent: true,
    });
  }

  // 2. Discover agent-managed worktrees from ~/.omp/wt/
  try {
    const agentWts = await listWorktrees({ json: true });
    if (Array.isArray(agentWts)) {
      for (const wt of agentWts) {
        const wtPath = path.resolve(wt.path);
        if (!result.some(r => r.path === wtPath)) {
          result.push({
            path: wtPath,
            branch: wt.branch ?? "isolated",
            head: "HEAD",
            kind: wt.orphanReason
              ? "orphan"
              : wt.kind === "task-isolation"
                ? "task-isolation"
                : "pr-checkout",
            isCurrent: wtPath === normalizedProject,
          });
        }
      }
    }
  } catch {}

  return result;
}

/**
 * Create a new git worktree for the project and checkout/create branch (/wt or /worktree).
 */
export async function createNewWorktree(
  projectCwd: string,
  inputArg?: string,
): Promise<{ worktreePath: string; branch: string }> {
  const normalizedProject = path.resolve(projectCwd);
  const repoName = path.basename(normalizedProject);
  const rawArg = inputArg?.trim();

  let targetPath: string;
  let targetBranch: string;

  if (rawArg) {
    if (
      path.isAbsolute(rawArg) ||
      rawArg.startsWith("./") ||
      rawArg.startsWith(".\\") ||
      rawArg.startsWith("../") ||
      rawArg.startsWith("..\\")
    ) {
      targetPath = path.resolve(normalizedProject, rawArg);
      targetBranch = path.basename(targetPath);
    } else {
      targetBranch = rawArg;
      targetPath = path.resolve(path.dirname(normalizedProject), `${repoName}-${rawArg}`);
    }
  } else {
    const stamp = Date.now().toString(36);
    targetBranch = `wt-${stamp}`;
    targetPath = path.resolve(path.dirname(normalizedProject), `${repoName}-${targetBranch}`);
  }

  await addWorktree({
    cwd: normalizedProject,
    path: targetPath,
    branch: targetBranch,
    detach: false,
    quiet: true,
  });

  return { worktreePath: targetPath, branch: targetBranch };
}

/**
 * Draw the Git Worktrees surface (/wt -> "session-wt").
 */
export async function drawWorktreeSurface(live: LiveSession): Promise<void> {
  const cwd = live.manager.getCwd();
  const worktrees = await discoverWorktrees(cwd);

  const total = worktrees.length;
  const linked = worktrees.filter(w => w.kind === "linked" || w.kind === "task-isolation").length;
  const main = worktrees.find(w => w.kind === "main");

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "wt-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "wt-col",
      component: "Column",
      children: ["wt-header", "wt-metrics", "wt-table-card"],
      gap: "md",
    },
    {
      id: "wt-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["wt-title", "wt-badge"],
    },
    { id: "wt-title", component: "Text", text: "Git Worktrees (/worktrees)", variant: "heading" },
    {
      id: "wt-badge",
      component: "Badge",
      label: `${total} worktree${total === 1 ? "" : "s"} · ${path.basename(cwd)}`,
      color: "cyan",
      size: "sm",
    },
    {
      id: "wt-metrics",
      component: "Row",
      children: ["m-total", "m-linked", "m-main", "m-dir"],
      justify: "spaceBetween",
      gap: "sm",
    },
    {
      id: "m-total",
      component: "Card",
      child: "m-total-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    {
      id: "m-total-col",
      component: "Column",
      children: ["m-total-val", "m-total-lbl"],
      gap: 2,
      align: "center",
    },
    { id: "m-total-val", component: "Text", text: String(total), variant: "heading" },
    { id: "m-total-lbl", component: "Text", text: "Total Worktrees", variant: "caption" },

    {
      id: "m-linked",
      component: "Card",
      child: "m-linked-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    {
      id: "m-linked-col",
      component: "Column",
      children: ["m-linked-val", "m-linked-lbl"],
      gap: 2,
      align: "center",
    },
    { id: "m-linked-val", component: "Text", text: String(linked), variant: "heading" },
    { id: "m-linked-lbl", component: "Text", text: "Linked / Isolated", variant: "caption" },

    {
      id: "m-main",
      component: "Card",
      child: "m-main-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    {
      id: "m-main-col",
      component: "Column",
      children: ["m-main-val", "m-main-lbl"],
      gap: 2,
      align: "center",
    },
    { id: "m-main-val", component: "Text", text: main?.branch ?? "main", variant: "heading" },
    { id: "m-main-lbl", component: "Text", text: "Main Branch", variant: "caption" },

    {
      id: "m-dir",
      component: "Card",
      child: "m-dir-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    { id: "m-dir-col", component: "Column", children: ["m-dir-val", "m-dir-lbl"], gap: 2, align: "center" },
    { id: "m-dir-val", component: "Text", text: path.basename(cwd), variant: "heading" },
    { id: "m-dir-lbl", component: "Text", text: "Active Project", variant: "caption" },

    {
      id: "wt-table-card",
      component: "Card",
      child: "wt-table-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
    },
    {
      id: "wt-table-col",
      component: "Column",
      children: ["wt-table-title", "wt-table"],
      gap: "xs",
    },
    { id: "wt-table-title", component: "Text", text: "Registered Worktrees", variant: "body" },
    {
      id: "wt-table",
      component: "Table",
      headers: ["Location", "Branch", "Commit", "Type", "Status"],
      rows: worktrees.map(wt => [
        wt.path.length > 45 ? "…" + wt.path.slice(-42) : wt.path,
        wt.branch,
        wt.head,
        wt.kind.toUpperCase(),
        wt.isCurrent ? "● CURRENT" : "IDLE",
      ]),
      striped: true,
      highlightOnHover: true,
    },
  ];

  live.a2ui.recreateSurface({
    surfaceId: WT_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}
