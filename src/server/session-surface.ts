/**
 * Session Information A2UI surface: /session -> "session-info".
 *
 * Renders a structured overview of the active session: session key/ID, title,
 * working directory, disk storage path, model & thinking tier, token economics,
 * turn counts, context utilization, and active tools.
 */
import * as path from "node:path";

import { formatBytes } from "@oh-my-pi/pi-utils";

import { SESSION_SURFACE_ID, type A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Draw the Session Information surface (/session -> "session-info").
 */
export async function drawSessionInfoSurface(live: LiveSession): Promise<void> {
  const model = live.session.model;
  const usage = live.session.getContextUsage();
  const sessionId = live.manager.getSessionId();
  const title = live.manager.getSessionName() || "Untitled session";
  const cwd = live.manager.getCwd();
  const sessionFile = live.session.sessionFile ?? "";
  const thinkingLevel = live.session.thinkingLevel ?? "off";

  let assistantTurns = 0;
  let totalDurationMs = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const msg of live.session.messages) {
    if (msg.role === "assistant") {
      assistantTurns++;
      totalDurationMs += msg.duration ?? 0;
      if (msg.usage) {
        totalTokens += msg.usage.totalTokens;
        if (msg.usage.cost) {
          totalCost += msg.usage.cost.total;
        }
      }
    }
  }

  const activeTools = live.session.getActiveToolNames();
  const todoPhases = (live.session.getTodoPhases() as any[]) ?? [];
  const allTasks = todoPhases.flatMap(p => p.tasks);
  const doneTasks = allTasks.filter(t => t.status === "completed").length;

  const usedPct = usage?.percent ? Math.round(usage.percent) : 0;
  const contextTokens = usage?.tokens ?? 0;
  const contextWindow = usage?.contextWindow ?? 0;

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "sess-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "sess-col",
      component: "Column",
      children: ["sess-header", "sess-metrics", "sess-details-card", "sess-env-card"],
      gap: "md",
    },
    {
      id: "sess-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["sess-title", "sess-badge"],
    },
    { id: "sess-title", component: "Text", text: "Session Information", variant: "heading" },
    {
      id: "sess-badge",
      component: "Badge",
      label: `${sessionId.slice(0, 8)} · ${model?.name ?? model?.id ?? "No Model"}`,
      color: "cyan",
      size: "lg",
      variant: "light",
    },

    // Metrics Row (Responsive with weight: 1)
    {
      id: "sess-metrics",
      component: "Row",
      children: ["m-model", "m-turns", "m-cost", "m-context"],
      justify: "spaceBetween",
    },
    {
      id: "m-model",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-model", "v-model", "b-model"],
    },
    { id: "l-model", component: "Text", text: "Active Model", variant: "caption" },
    { id: "v-model", component: "Text", text: model?.name ?? "Default", variant: "heading" },
    {
      id: "b-model",
      component: "Badge",
      label: `Thinking: ${thinkingLevel}`,
      color: thinkingLevel === "off" ? "gray" : "plum",
      size: "xs",
      variant: "light",
    },

    {
      id: "m-turns",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-turns", "v-turns", "b-turns"],
    },
    { id: "l-turns", component: "Text", text: "Turns & Duration", variant: "caption" },
    { id: "v-turns", component: "Text", text: `${assistantTurns} turns`, variant: "heading" },
    {
      id: "b-turns",
      component: "Badge",
      label: `Duration: ${formatDurationMs(totalDurationMs)}`,
      color: "cyan",
      size: "xs",
      variant: "light",
    },

    {
      id: "m-cost",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-cost", "v-cost", "b-cost"],
    },
    { id: "l-cost", component: "Text", text: "Tokens & Cost", variant: "caption" },
    {
      id: "v-cost",
      component: "Text",
      text: totalCost > 0 ? `$${totalCost.toFixed(3)}` : `${totalTokens.toLocaleString()} tok`,
      variant: "heading",
    },
    {
      id: "b-cost",
      component: "Badge",
      label: `${totalTokens.toLocaleString()} total tokens`,
      color: "teal",
      size: "xs",
      variant: "light",
    },

    {
      id: "m-context",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-context", "v-context", "b-context"],
    },
    { id: "l-context", component: "Text", text: "Context Utilization", variant: "caption" },
    { id: "v-context", component: "Text", text: `${usedPct}% used`, variant: "heading" },
    {
      id: "b-context",
      component: "Progress",
      value: usedPct,
      color: usedPct >= 90 ? "red" : usedPct >= 70 ? "yellow" : "cyan",
      size: "sm",
    },

    // Session Details Card
    {
      id: "sess-details-card",
      component: "Card",
      child: "sess-details-col",
      shadow: "xs",
      p: "sm",
      withBorder: true,
    },
    {
      id: "sess-details-col",
      component: "Column",
      children: ["sess-details-title", "sess-details-table"],
      gap: "xs",
    },
    { id: "sess-details-title", component: "Text", text: "Session Identity & Storage", variant: "body" },
    {
      id: "sess-details-table",
      component: "Table",
      headers: ["Property", "Value"],
      rows: [
        ["Session ID", sessionId],
        ["Title", title],
        ["Workspace Directory", cwd],
        ["Disk Storage Path", sessionFile || "In-memory (unsaved)"],
        ["Streaming Status", live.session.isStreaming ? "● In Flight (Streaming)" : "Idle"],
        ["Tasks / Todos", `${allTasks.length} tasks (${doneTasks} done across ${todoPhases.length} phases)`],
        ["Visible Tools", `${activeTools.length} tools active`],
      ],
      striped: true,
      highlightOnHover: true,
    },

    // Runtime Environment Card
    {
      id: "sess-env-card",
      component: "Card",
      child: "sess-env-col",
      shadow: "xs",
      p: "sm",
      withBorder: true,
    },
    {
      id: "sess-env-col",
      component: "Column",
      children: ["sess-env-title", "sess-env-table"],
      gap: "xs",
    },
    { id: "sess-env-title", component: "Text", text: "Runtime & Provider", variant: "body" },
    {
      id: "sess-env-table",
      component: "Table",
      headers: ["Component", "Details"],
      rows: [
        ["Provider", model?.provider ? model.provider.toUpperCase() : "N/A"],
        ["Model ID", model?.id ?? "None"],
        ["Context Window", contextWindow > 0 ? `${contextWindow.toLocaleString()} tokens` : "Unknown"],
        ["Active Usage", contextTokens > 0 ? `${contextTokens.toLocaleString()} tokens occupied` : "0"],
        ["Project Root", path.basename(cwd)],
      ],
      striped: true,
      highlightOnHover: true,
    },
  ];

  live.a2ui.recreateSurface({
    surfaceId: SESSION_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}
