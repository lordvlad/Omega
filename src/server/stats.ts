/**
 * Telemetry A2UI surfaces: Cost, Quotas, and Performance Stats.
 *
 * Each command (/cost, /usage, /stats) renders its own dedicated surface:
 * - /cost  -> "session-cost"  (Token economics, burn rate, token proportions)
 * - /usage -> "session-usage" (Provider quotas, rate limits, reset timers)
 * - /stats -> "session-stats" (Turn latency, execution duration, tool call frequency)
 */
import { resolveUsedFraction, type UsageLimit, type UsageReport } from "@oh-my-pi/pi-ai/usage";

import type { A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";
function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(c: number): string {
  if (c < 0.01) return `$${c.toFixed(4)}`;
  if (c < 1) return `$${c.toFixed(3)}`;
  return `$${c.toFixed(2)}`;
}

function formatProviderName(provider: string | undefined): string {
  if (!provider) return "Provider";
  return provider
    .split(/[-_]/g)
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ""))
    .join(" ");
}

function formatResetTime(resetsAt: number | undefined, resetLabel = "resets"): string | undefined {
  if (resetsAt === undefined || Number.isNaN(resetsAt)) return undefined;
  const now = Date.now();
  const diffMs = resetsAt - now;
  if (diffMs <= 0) return `${resetLabel} now`;

  const totalSec = Math.floor(diffMs / 1000);
  const totalMin = Math.floor(totalSec / 60);
  const totalHours = Math.floor(totalMin / 60);
  const totalDays = Math.floor(totalHours / 24);

  let durationText = "";
  if (totalDays > 0) {
    const remHours = totalHours % 24;
    durationText = remHours > 0 ? `${totalDays}d ${remHours}h` : `${totalDays}d`;
  } else if (totalHours > 0) {
    const remMin = totalMin % 60;
    durationText = remMin > 0 ? `${totalHours}h ${remMin}m` : `${totalHours}h`;
  } else if (totalMin > 0) {
    const remSec = totalSec % 60;
    durationText = remSec > 0 ? `${totalMin}m ${remSec}s` : `${totalMin}m`;
  } else {
    durationText = `${totalSec}s`;
  }

  const date = new Date(resetsAt);
  const timeStr = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${resetLabel} in ${durationText} (${timeStr})`;
}

export const COST_SURFACE_ID = "session-cost";
export const USAGE_SURFACE_ID = "session-usage";
export const STATS_SURFACE_ID = "session-stats";

/** Backwards-compatible alias for any legacy callers */
export const METRICS_SURFACE_ID = "session-metrics";

/**
 * Draw the Token Economics & Cost surface (/cost -> "session-cost").
 */
export async function drawCostSurface(live: LiveSession): Promise<void> {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalTokens = 0;
  let totalCost = 0;

  const costSeries: { turn: number; cost: number; inputCost: number; outputCost: number }[] = [];
  let turnIndex = 0;

  for (const msg of live.session.messages) {
    if (msg.role === "assistant") {
      turnIndex++;
      let turnInputCost = 0;
      let turnOutputCost = 0;
      let turnCost = 0;

      if (msg.usage) {
        totalInput += msg.usage.input;
        totalOutput += msg.usage.output;
        totalCacheRead += msg.usage.cacheRead;
        totalCacheWrite += msg.usage.cacheWrite;
        totalTokens += msg.usage.totalTokens;

        if (msg.usage.cost) {
          totalCost += msg.usage.cost.total;
          turnInputCost = msg.usage.cost.input;
          turnOutputCost = msg.usage.cost.output;
          turnCost = msg.usage.cost.total;
        }
      }

      costSeries.push({
        turn: turnIndex,
        cost: Number(turnCost.toFixed(4)),
        inputCost: Number(turnInputCost.toFixed(4)),
        outputCost: Number(turnOutputCost.toFixed(4)),
      });
    }
  }

  const tokenBreakdown = [
    { name: "Input", value: totalInput, color: "cyan" },
    { name: "Output", value: totalOutput, color: "plum" },
    { name: "Cache Read", value: totalCacheRead, color: "teal" },
    { name: "Cache Write", value: totalCacheWrite, color: "yellow" },
  ].filter(d => d.value > 0);

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "cost-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "cost-col",
      component: "Column",
      children: ["cost-header", "cost-metrics", "cost-charts"],
      gap: "md",
    },
    {
      id: "cost-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["cost-title", "cost-total-badge"],
    },
    { id: "cost-title", component: "Text", text: "Token Economics & Cost", variant: "heading" },
    {
      id: "cost-total-badge",
      component: "Badge",
      label: `Total: ${formatCost(totalCost)} · ${turnIndex} turns`,
      color: "cyan",
      size: "lg",
      variant: "light",
    },

    // Metrics Row
    {
      id: "cost-metrics",
      component: "Row",
      children: ["m-input", "m-output", "m-read", "m-write"],
      justify: "spaceBetween",
    },
    {
      id: "m-input",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-input", "v-input", "b-input"],
    },
    { id: "l-input", component: "Text", text: "Input Tokens", variant: "caption" },
    { id: "v-input", component: "Text", text: totalInput.toLocaleString(), variant: "heading" },
    {
      id: "b-input",
      component: "Progress",
      value: totalTokens > 0 ? (totalInput / totalTokens) * 100 : 0,
      color: "cyan",
      size: "sm",
    },

    {
      id: "m-output",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-output", "v-output", "b-output"],
    },
    { id: "l-output", component: "Text", text: "Output Tokens", variant: "caption" },
    { id: "v-output", component: "Text", text: totalOutput.toLocaleString(), variant: "heading" },
    {
      id: "b-output",
      component: "Progress",
      value: totalTokens > 0 ? (totalOutput / totalTokens) * 100 : 0,
      color: "plum",
      size: "sm",
    },

    {
      id: "m-read",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-read", "v-read", "b-read"],
    },
    { id: "l-read", component: "Text", text: "Cache Read", variant: "caption" },
    { id: "v-read", component: "Text", text: totalCacheRead.toLocaleString(), variant: "heading" },
    {
      id: "b-read",
      component: "Progress",
      value: totalTokens > 0 ? (totalCacheRead / totalTokens) * 100 : 0,
      color: "teal",
      size: "sm",
    },

    {
      id: "m-write",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-write", "v-write", "b-write"],
    },
    { id: "l-write", component: "Text", text: "Cache Write", variant: "caption" },
    { id: "v-write", component: "Text", text: totalCacheWrite.toLocaleString(), variant: "heading" },
    {
      id: "b-write",
      component: "Progress",
      value: totalTokens > 0 ? (totalCacheWrite / totalTokens) * 100 : 0,
      color: "yellow",
      size: "sm",
    },

    // Charts Row
    {
      id: "cost-charts",
      component: "Row",
      children: ["c-cost-card", "c-tokens-card"],
      justify: "spaceBetween",
      align: "start",
    },
    {
      id: "c-cost-card",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["c-cost-title", "chart-cost"],
    },
    { id: "c-cost-title", component: "Text", text: "Cost per Turn ($)", variant: "caption" },
    {
      id: "chart-cost",
      component: "AreaChart",
      data: costSeries,
      dataKey: "turn",
      series: [
        { name: "inputCost", color: "cyan", label: "Input Cost" },
        { name: "outputCost", color: "plum", label: "Output Cost" },
      ],
      height: 180,
      curveType: "monotone",
      withLegend: true,
    },

    {
      id: "c-tokens-card",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["c-tokens-title", "chart-tokens"],
    },
    { id: "c-tokens-title", component: "Text", text: "Token Proportions", variant: "caption" },
    {
      id: "chart-tokens",
      component: "DonutChart",
      data: tokenBreakdown.length > 0 ? tokenBreakdown : [{ name: "none", value: 1, color: "gray" }],
      size: 160,
      thickness: 16,
      withLabels: true,
      chartLabel: `${totalTokens.toLocaleString()} total`,
    },
  ];

  live.a2ui.recreateSurface({
    surfaceId: COST_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}

/**
 * Draw the Provider Quotas & Rate Limits surface (/usage -> "session-usage").
 */
export async function drawUsageSurface(live: LiveSession): Promise<void> {
  let reports: UsageReport[] | null = null;
  try {
    reports = await live.session.fetchUsageReports();
  } catch {
    reports = null;
  }

  const quotasListChildren: string[] = [];
  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "usage-col", shadow: "xs", p: "md", withBorder: true },
    { id: "usage-col", component: "Column", children: ["usage-header", "quotas-list"], gap: "sm" },
    {
      id: "usage-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["usage-title", "usage-badge"],
    },
    { id: "usage-title", component: "Text", text: "Provider Quotas & Rate Limits", variant: "heading" },
    {
      id: "usage-badge",
      component: "Badge",
      label:
        reports && reports.length > 0
          ? `${reports.length} provider${reports.length > 1 ? "s" : ""}`
          : "Active Provider",
      color: "plum",
      size: "lg",
      variant: "light",
    },
    { id: "quotas-list", component: "Column", children: quotasListChildren, gap: "sm" },
  ];

  if (!reports || reports.length === 0) {
    quotasListChildren.push("quotas-empty-alert");
    components.push({
      id: "quotas-empty-alert",
      component: "Alert",
      title: "No Live Quota Endpoint",
      text: "The active provider or credentials do not expose live rate-limit quota endpoints (common for standard API key access). Token counts and cost metrics are tracked with /cost.",
      color: "cyan",
      icon: "info",
    });
  } else {
    for (let pIdx = 0; pIdx < reports.length; pIdx++) {
      const report = reports[pIdx]!;
      const pCardId = `p-card-${pIdx}`;
      const pColId = `p-col-${pIdx}`;
      const pHeadId = `p-head-${pIdx}`;
      const pTitleId = `p-title-${pIdx}`;
      const pMetaId = `p-meta-${pIdx}`;
      const limitsListId = `p-limits-${pIdx}`;
      const limitsListChildren: string[] = [];

      quotasListChildren.push(pCardId);

      const providerName = formatProviderName(report.provider);

      components.push(
        { id: pCardId, component: "Paper", p: "sm", shadow: "xs", withBorder: true, child: pColId },
        { id: pColId, component: "Column", children: [pHeadId, limitsListId], gap: "xs" },
        {
          id: pHeadId,
          component: "Row",
          justify: "spaceBetween",
          align: "center",
          children: [pTitleId, pMetaId],
        },
        { id: pTitleId, component: "Text", text: providerName, variant: "heading" },
        {
          id: pMetaId,
          component: "Badge",
          label: report.limits.length > 0 ? `${report.limits.length} limits` : "active",
          color: "plum",
          size: "xs",
          variant: "light",
        },
        { id: limitsListId, component: "Column", children: limitsListChildren, gap: "xs" },
      );

      for (let lIdx = 0; lIdx < report.limits.length; lIdx++) {
        const limit: UsageLimit = report.limits[lIdx]!;
        const lId = `p-${pIdx}-limit-${lIdx}`;
        const lRowId = `p-${pIdx}-lrow-${lIdx}`;
        const lLblId = `p-${pIdx}-lbl-${lIdx}`;
        const lAmtId = `p-${pIdx}-amt-${lIdx}`;
        const lProgId = `p-${pIdx}-prog-${lIdx}`;

        limitsListChildren.push(lId);
        const fraction = resolveUsedFraction(limit) ?? 0;
        const pct = Math.round(fraction * 100);
        const color = fraction >= 1 ? "red" : fraction >= 0.8 ? "yellow" : "teal";

        let desc = limit.label || "Quota Window";
        if (limit.amount.used !== undefined && limit.amount.limit !== undefined) {
          desc += ` (${limit.amount.used.toLocaleString()} / ${limit.amount.limit.toLocaleString()} ${limit.amount.unit})`;
        } else if (limit.amount.remaining !== undefined) {
          desc += ` (${limit.amount.remaining.toLocaleString()} ${limit.amount.unit} left)`;
        }

        const resetText = formatResetTime(limit.window?.resetsAt, limit.window?.resetLabel);
        const amtText = resetText ? `${pct}% used · ${resetText}` : `${pct}% used`;

        components.push(
          { id: lId, component: "Column", children: [lRowId, lProgId], gap: 2 },
          {
            id: lRowId,
            component: "Row",
            justify: "spaceBetween",
            align: "center",
            children: [lLblId, lAmtId],
          },
          { id: lLblId, component: "Text", text: desc, variant: "caption" },
          { id: lAmtId, component: "Text", text: amtText, variant: "caption" },
          { id: lProgId, component: "Progress", value: Math.min(100, pct), color, size: "sm" },
        );
      }

      if (report.resetCredits && report.resetCredits.availableCount > 0) {
        const creditId = `p-${pIdx}-credits`;
        limitsListChildren.push(creditId);
        components.push({
          id: creditId,
          component: "Badge",
          label: `Saved rate-limit resets: ${report.resetCredits.availableCount} available`,
          color: "cyan",
          size: "xs",
          variant: "outline",
        });
      }
    }
  }

  live.a2ui.recreateSurface({
    surfaceId: USAGE_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}

/**
 * Draw the Performance & Latency Stats surface (/stats -> "session-stats").
 */
export async function drawStatsSurface(live: LiveSession): Promise<void> {
  const toolsCounts: Record<string, number> = {};
  const latencies: { turn: number; latencySec: number; contextTokens: number }[] = [];

  let turnIndex = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;
  let totalToolCalls = 0;

  for (const msg of live.session.messages) {
    if (msg.role === "assistant") {
      turnIndex++;
      const dur = msg.duration ?? 0;
      totalLatencyMs += dur;
      if (dur > maxLatencyMs) maxLatencyMs = dur;

      const occupied = msg.usage?.contextTokens || msg.usage?.totalTokens || 0;

      latencies.push({
        turn: turnIndex,
        latencySec: Number((dur / 1000).toFixed(2)),
        contextTokens: occupied,
      });

      for (const part of msg.content) {
        if (part.type === "toolCall") {
          totalToolCalls++;
          toolsCounts[part.name] = (toolsCounts[part.name] || 0) + 1;
        }
      }
    }
  }

  const avgLatencyMs = turnIndex > 0 ? Math.round(totalLatencyMs / turnIndex) : 0;

  const toolData = Object.entries(toolsCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value], i) => ({
      name,
      value,
      color: ["cyan", "plum", "teal", "yellow", "orange", "red", "gray", "blue"][i % 8],
    }));

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "stats-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "stats-col",
      component: "Column",
      children: ["stats-header", "stats-metrics", "stats-charts"],
      gap: "md",
    },
    {
      id: "stats-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["stats-title", "stats-badge"],
    },
    { id: "stats-title", component: "Text", text: "Performance & Latency Stats", variant: "heading" },
    {
      id: "stats-badge",
      component: "Badge",
      label: `Avg: ${formatDurationMs(avgLatencyMs)} · ${totalToolCalls} tool call${totalToolCalls === 1 ? "" : "s"}`,
      color: "cyan",
      size: "lg",
      variant: "light",
    },

    // Metrics Row
    {
      id: "stats-metrics",
      component: "Row",
      children: ["m-avg", "m-max", "m-tools", "m-turns"],
      justify: "spaceBetween",
    },
    {
      id: "m-avg",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-avg", "v-avg"],
    },
    { id: "l-avg", component: "Text", text: "Average Latency", variant: "caption" },
    { id: "v-avg", component: "Text", text: formatDurationMs(avgLatencyMs), variant: "heading" },

    {
      id: "m-max",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-max", "v-max"],
    },
    { id: "l-max", component: "Text", text: "Max Latency", variant: "caption" },
    { id: "v-max", component: "Text", text: formatDurationMs(maxLatencyMs), variant: "heading" },

    {
      id: "m-tools",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-tools", "v-tools"],
    },
    { id: "l-tools", component: "Text", text: "Tool Invocations", variant: "caption" },
    { id: "v-tools", component: "Text", text: totalToolCalls.toString(), variant: "heading" },

    {
      id: "m-turns",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["l-turns", "v-turns"],
    },
    { id: "l-turns", component: "Text", text: "Completed Turns", variant: "caption" },
    { id: "v-turns", component: "Text", text: turnIndex.toString(), variant: "heading" },

    // Charts Row
    {
      id: "stats-charts",
      component: "Row",
      children: ["c-latency-card", "c-tools-card"],
      justify: "spaceBetween",
      align: "start",
    },
    {
      id: "c-latency-card",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["c-latency-title", "chart-latency"],
    },
    { id: "c-latency-title", component: "Text", text: "Turn Latency (Seconds)", variant: "caption" },
    {
      id: "chart-latency",
      component: "LineChart",
      data: latencies,
      dataKey: "turn",
      series: [{ name: "latencySec", color: "cyan", label: "Latency (s)" }],
      height: 180,
      curveType: "monotone",
      withDots: true,
    },

    {
      id: "c-tools-card",
      component: "Paper",
      p: "sm",
      shadow: "xs",
      withBorder: true,
      weight: 1,
      children: ["c-tools-title", "chart-tools"],
    },
    { id: "c-tools-title", component: "Text", text: "Tool Invocation Frequency", variant: "caption" },
    {
      id: "chart-tools",
      component: "BarChart",
      data: toolData.length > 0 ? toolData : [{ name: "none", value: 1, color: "gray" }],
      dataKey: "name",
      series: [{ name: "value", color: "plum", label: "Calls" }],
      height: 180,
      withTooltip: true,
    },
  ];

  live.a2ui.recreateSurface({
    surfaceId: STATS_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}
