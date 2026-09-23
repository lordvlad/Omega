/**
 * Context Window Usage A2UI surface: /context -> "session-context".
 *
 * Visualizes the same breakdown the TUI's ASCII `/context` report is built
 * from (`computeSessionContextBreakdown`): category tokens (system prompt,
 * system context, tools, skills, messages), the auto-compact buffer, and the
 * remaining free space, plus a per-turn trend and any snapcompact wire
 * savings estimate.
 */
import { computeSessionContextBreakdown } from "@oh-my-pi/pi-coding-agent/session/context-usage-runtime";

import { CONTEXT_SURFACE_ID, type A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";

/** Mantine color per context category id (matches the TUI's semantic grouping). */
const CATEGORY_COLORS: Record<string, string> = {
  systemPrompt: "cyan",
  systemContext: "plum",
  systemTools: "teal",
  skills: "orange",
  messages: "yellow",
};

/**
 * Draw the Context Window Usage surface (/context -> "session-context").
 */
export async function drawContextSurface(live: LiveSession): Promise<void> {
  const breakdown = computeSessionContextBreakdown(live.session, { snapcompactSavings: true });

  if (!(breakdown.contextWindow > 0)) {
    live.a2ui.recreateSurface({
      surfaceId: CONTEXT_SURFACE_ID,
      sendDataModel: false,
      components: [
        { id: "root", component: "Card", child: "ctx-empty-alert", shadow: "xs", p: "md", withBorder: true },
        {
          id: "ctx-empty-alert",
          component: "Alert",
          title: "Context Usage Unavailable",
          text: "No model is selected for this session, so the context window size is unknown.",
          color: "cyan",
          icon: "info",
        },
      ],
    });
    return;
  }

  const usedPct = Math.round((breakdown.usedTokens / breakdown.contextWindow) * 100);

  const categoryData = breakdown.categories
    .filter(c => c.tokens > 0)
    .map(c => ({ name: c.label, value: c.tokens, color: CATEGORY_COLORS[c.id] ?? "gray" }));
  if (breakdown.autoCompactBufferTokens > 0) {
    categoryData.push({
      name: "Auto-compact buffer",
      value: breakdown.autoCompactBufferTokens,
      color: "red",
    });
  }
  if (breakdown.freeTokens > 0) {
    categoryData.push({ name: "Free", value: breakdown.freeTokens, color: "gray" });
  }

  // Per-turn context growth trend, same field access pattern as /stats.
  const contextTrend: { turn: number; tokens: number }[] = [];
  let turnIndex = 0;
  for (const msg of live.session.messages) {
    if (msg.role === "assistant") {
      turnIndex++;
      const occupied = msg.usage?.contextTokens || msg.usage?.totalTokens || 0;
      contextTrend.push({ turn: turnIndex, tokens: occupied });
    }
  }

  const snap = breakdown.snapcompact;
  const showSnapAlert = snap?.visionCapable === true && snap.savedTokens > 0;

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "ctx-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "ctx-col",
      component: "Column",
      children: showSnapAlert
        ? ["ctx-header", "ctx-metrics", "ctx-charts", "ctx-snap-alert"]
        : ["ctx-header", "ctx-metrics", "ctx-charts"],
      gap: "md",
    },
    {
      id: "ctx-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["ctx-title", "ctx-badge"],
    },
    { id: "ctx-title", component: "Text", text: "Context Window Usage", variant: "heading" },
    {
      id: "ctx-badge",
      component: "Badge",
      label: `${usedPct}% used · ${breakdown.contextWindow.toLocaleString()} tokens`,
      color: usedPct >= 90 ? "red" : usedPct >= 70 ? "yellow" : "cyan",
      size: "lg",
      variant: "light",
    },

    // Metrics Row
    {
      id: "ctx-metrics",
      component: "Row",
      children: ["m-used", "m-free", "m-buffer", "m-window"],
      justify: "spaceBetween",
    },
    {
      id: "m-used",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-used", "v-used", "b-used"],
    },
    { id: "l-used", component: "Text", text: "Used Tokens", variant: "caption" },
    { id: "v-used", component: "Text", text: breakdown.usedTokens.toLocaleString(), variant: "heading" },
    { id: "b-used", component: "Progress", value: usedPct, color: "cyan", size: "sm" },

    {
      id: "m-free",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-free", "v-free", "b-free"],
    },
    { id: "l-free", component: "Text", text: "Free Tokens", variant: "caption" },
    { id: "v-free", component: "Text", text: breakdown.freeTokens.toLocaleString(), variant: "heading" },
    {
      id: "b-free",
      component: "Progress",
      value: (breakdown.freeTokens / breakdown.contextWindow) * 100,
      color: "gray",
      size: "sm",
    },

    {
      id: "m-buffer",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-buffer", "v-buffer", "b-buffer"],
    },
    { id: "l-buffer", component: "Text", text: "Auto-compact Buffer", variant: "caption" },
    {
      id: "v-buffer",
      component: "Text",
      text: breakdown.autoCompactBufferTokens.toLocaleString(),
      variant: "heading",
    },
    {
      id: "b-buffer",
      component: "Progress",
      value: (breakdown.autoCompactBufferTokens / breakdown.contextWindow) * 100,
      color: "red",
      size: "sm",
    },

    {
      id: "m-window",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-window", "v-window"],
    },
    { id: "l-window", component: "Text", text: "Context Window", variant: "caption" },
    { id: "v-window", component: "Text", text: breakdown.contextWindow.toLocaleString(), variant: "heading" },

    // Charts Row
    {
      id: "ctx-charts",
      component: "Row",
      children: ["c-trend-card", "c-breakdown-card"],
      justify: "spaceBetween",
      align: "start",
    },
    {
      id: "c-trend-card",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["c-trend-title", "chart-trend"],
    },
    { id: "c-trend-title", component: "Text", text: "Context Growth per Turn", variant: "caption" },
    {
      id: "chart-trend",
      component: "AreaChart",
      data: contextTrend.length > 0 ? contextTrend : [{ turn: 0, tokens: 0 }],
      dataKey: "turn",
      series: [{ name: "tokens", color: "cyan", label: "Context Tokens" }],
      height: 180,
      curveType: "monotone",
    },

    {
      id: "c-breakdown-card",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["c-breakdown-title", "chart-breakdown"],
    },
    { id: "c-breakdown-title", component: "Text", text: "Category Breakdown", variant: "caption" },
    {
      id: "chart-breakdown",
      component: "DonutChart",
      data: categoryData.length > 0 ? categoryData : [{ name: "none", value: 1, color: "gray" }],
      size: 160,
      thickness: 16,
      withLabels: true,
      chartLabel: `${usedPct}% used`,
    },
  ];

  if (showSnapAlert && snap) {
    components.push({
      id: "ctx-snap-alert",
      component: "Alert",
      title: "Snapcompact Savings Available",
      text: `Rendering the system prompt and imaged tool results would save an estimated ${snap.savedTokens.toLocaleString()} tokens on the wire for the next request (~${(breakdown.usedTokens - snap.savedTokens).toLocaleString()} tokens instead of ${breakdown.usedTokens.toLocaleString()}).`,
      color: "teal",
      icon: "info",
    });
  }

  live.a2ui.recreateSurface({
    surfaceId: CONTEXT_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}
