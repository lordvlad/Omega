/**
 * Agents Hub A2UI surface: /agents -> "session-agents".
 *
 * Renders the session's active and historical subagents, available agent roles
 * (task, scout, reviewer, security-reviewer, sonic), delegation capabilities,
 * tool permissions, and execution status.
 */
import { AGENTS_SURFACE_ID, type A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";

function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now();
  const diffSec = Math.max(0, Math.round((end - startedAt) / 1000));
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

/** Built-in agent role specifications and tool grants. */
const BUILTIN_AGENT_ROLES = [
  {
    name: "task",
    color: "teal",
    type: "Read-Write",
    description: "General-purpose multi-step worker with full tool access (read, write, edit, bash, eval).",
    tools: "read, write, edit, bash, eval, tools",
  },
  {
    name: "scout",
    color: "cyan",
    type: "Read-Only",
    description: "Fast read-only exploratory codebase research, rapid code analysis, and broad pattern mapping.",
    tools: "read, grep, glob",
  },
  {
    name: "reviewer",
    color: "plum",
    type: "Read-Only",
    description: "Code review specialist for architecture, security, and quality analysis.",
    tools: "read, grep, glob, lsp",
  },
  {
    name: "security-reviewer",
    color: "red",
    type: "Read-Only",
    description: "Specialist for evidence-backed repository vulnerability and anchor discovery.",
    tools: "read, grep, glob",
  },
  {
    name: "sonic",
    color: "yellow",
    type: "Mechanical",
    description: "Low-reasoning agent for strictly mechanical updates, bulk formatting, or data collection.",
    tools: "read, edit, write",
  },
];

/**
 * Draw the Agents Hub surface (/agents -> "session-agents").
 */
export async function drawAgentsSurface(live: LiveSession): Promise<void> {
  const subagents = live.subagents;
  const activeCount = subagents.filter((s) => s.status === "running").length;
  const completedCount = subagents.filter((s) => s.status === "completed").length;
  const failedCount = subagents.filter((s) => s.status === "failed" || s.status === "aborted").length;
  const model = live.session.model;

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "agents-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "agents-col",
      component: "Column",
      children: ["agents-header", "agents-metrics", "agents-roster-card", "agents-catalog-card"],
      gap: "md",
    },
    {
      id: "agents-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["agents-title", "agents-badge"],
    },
    { id: "agents-title", component: "Text", text: "Agents Hub & Delegation", variant: "heading" },
    {
      id: "agents-badge",
      component: "Badge",
      label: activeCount > 0 ? `${activeCount} active · ${subagents.length} total` : `${subagents.length} subagents`,
      color: activeCount > 0 ? "plum" : "teal",
      size: "lg",
      variant: "light",
    },

    // Metrics Row (Responsive with weight: 1)
    {
      id: "agents-metrics",
      component: "Row",
      children: ["m-active", "m-completed", "m-roles", "m-parent"],
      justify: "spaceBetween",
    },
    {
      id: "m-active",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-active", "v-active", "b-active"],
    },
    { id: "l-active", component: "Text", text: "Active Subagents", variant: "caption" },
    { id: "v-active", component: "Text", text: `${activeCount} running`, variant: "heading" },
    {
      id: "b-active",
      component: "Badge",
      label: activeCount > 0 ? "IN FLIGHT" : "IDLE",
      color: activeCount > 0 ? "plum" : "gray",
      size: "xs",
      variant: activeCount > 0 ? "filled" : "light",
    },

    {
      id: "m-completed",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-completed", "v-completed", "b-completed"],
    },
    { id: "l-completed", component: "Text", text: "Finished Tasks", variant: "caption" },
    { id: "v-completed", component: "Text", text: `${completedCount} completed`, variant: "heading" },
    {
      id: "b-completed",
      component: "Badge",
      label: failedCount > 0 ? `${failedCount} failed` : "ALL SUCCEEDED",
      color: failedCount > 0 ? "red" : "teal",
      size: "xs",
      variant: "light",
    },

    {
      id: "m-roles",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-roles", "v-roles", "b-roles"],
    },
    { id: "l-roles", component: "Text", text: "Agent Specialists", variant: "caption" },
    { id: "v-roles", component: "Text", text: "5 Built-in Roles", variant: "heading" },
    {
      id: "b-roles",
      component: "Badge",
      label: "scout · reviewer · task…",
      color: "cyan",
      size: "xs",
      variant: "light",
    },

    {
      id: "m-parent",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-parent", "v-parent", "b-parent"],
    },
    { id: "l-parent", component: "Text", text: "Host Session", variant: "caption" },
    { id: "v-parent", component: "Text", text: model?.name ?? "Default Model", variant: "heading" },
    {
      id: "b-parent",
      component: "Badge",
      label: `Thinking: ${live.session.thinkingLevel ?? "off"}`,
      color: "plum",
      size: "xs",
      variant: "light",
    },

    // Subagent Roster Card
    {
      id: "agents-roster-card",
      component: "Card",
      child: "agents-roster-col",
      shadow: "xs",
      p: "sm",
      withBorder: true,
    },
    {
      id: "agents-roster-col",
      component: "Column",
      children: ["agents-roster-title", subagents.length > 0 ? "agents-roster-table" : "agents-empty-alert"],
      gap: "xs",
    },
    { id: "agents-roster-title", component: "Text", text: "Subagents Roster", variant: "body" },
  ];

  if (subagents.length === 0) {
    components.push({
      id: "agents-empty-alert",
      component: "Alert",
      title: "No Subagents Spawned",
      text: "Subagents spawned by the agent or via the task delegation tool will appear here with execution status and duration.",
      color: "cyan",
      icon: "info",
    });
  } else {
    components.push({
      id: "agents-roster-table",
      component: "Table",
      headers: ["Agent", "ID", "Task / Objective", "Status", "Duration"],
      rows: subagents.map((s) => [
        s.agent.toUpperCase(),
        s.id,
        s.description || "General delegated workload",
        s.status === "running" ? "● RUNNING" : s.status === "completed" ? "✓ COMPLETED" : s.status.toUpperCase(),
        formatDuration(s.startedAt, s.completedAt),
      ]),
      striped: true,
      highlightOnHover: true,
    });
  }

  // Agent Roles Catalog Card
  components.push(
    {
      id: "agents-catalog-card",
      component: "Card",
      child: "agents-catalog-col",
      shadow: "xs",
      p: "sm",
      withBorder: true,
    },
    {
      id: "agents-catalog-col",
      component: "Column",
      children: ["agents-catalog-title", "agents-roles-table"],
      gap: "xs",
    },
    { id: "agents-catalog-title", component: "Text", text: "Specialist Roles Catalog", variant: "body" },
    {
      id: "agents-roles-table",
      component: "Table",
      headers: ["Role", "Permissions", "Description", "Granted Tools"],
      rows: BUILTIN_AGENT_ROLES.map((r) => [r.name.toUpperCase(), r.type, r.description, r.tools]),
      striped: true,
      highlightOnHover: true,
    },
  );

  live.a2ui.recreateSurface({
    surfaceId: AGENTS_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}
