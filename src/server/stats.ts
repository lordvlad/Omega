/**
 * Unified Session Telemetry A2UI surface: Cost, Quotas, and Performance Stats.
 *
 * All three commands (/cost, /usage, /stats) share a single surface ID
 * ("session-metrics") with cohesive Mantine tabs, avoiding duplicate surfaces.
 */
import { resolveUsedFraction, type UsageLimit, type UsageReport } from "@oh-my-pi/pi-ai/usage";

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

export const METRICS_SURFACE_ID = "session-metrics";

/**
 * Draw or update the unified session metrics surface with the specified active tab.
 * @param activeTab "0" = Cost & Tokens, "1" = Provider Quotas, "2" = Performance & Latency
 */
export async function drawMetricsDashboard(
  live: LiveSession,
  activeTab: "0" | "1" | "2" = "0",
): Promise<void> {
  // 1. Gather Cost & Token Metrics
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalTokens = 0;
  let totalCost = 0;

  const costSeries: { turn: number; cost: number; inputCost: number; outputCost: number }[] = [];
  const toolsCounts: Record<string, number> = {};
  const latencies: { turn: number; latencySec: number; contextTokens: number }[] = [];

  let turnIndex = 0;
  let totalLatencyMs = 0;
  let maxLatencyMs = 0;
  let totalToolCalls = 0;

  for (const msg of live.session.messages) {
    if (msg.role === "assistant") {
      turnIndex++;
      let turnInputCost = 0;
      let turnOutputCost = 0;
      let turnCost = 0;

      const dur = msg.duration ?? 0;
      totalLatencyMs += dur;
      if (dur > maxLatencyMs) maxLatencyMs = dur;

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

      const occupied = msg.usage?.contextTokens || msg.usage?.totalTokens || 0;

      costSeries.push({
        turn: turnIndex,
        cost: Number(turnCost.toFixed(4)),
        inputCost: Number(turnInputCost.toFixed(4)),
        outputCost: Number(turnOutputCost.toFixed(4)),
      });

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

  const tokenBreakdown = [
    { name: "Input", value: totalInput, color: "cyan" },
    { name: "Output", value: totalOutput, color: "plum" },
    { name: "Cache Read", value: totalCacheRead, color: "teal" },
    { name: "Cache Write", value: totalCacheWrite, color: "yellow" },
  ].filter(d => d.value > 0);

  const toolData = Object.entries(toolsCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, value], i) => ({
      name,
      value,
      color: ["cyan", "plum", "teal", "yellow", "orange", "red", "gray", "blue"][i % 8],
    }));

  // 2. Gather Provider Usage Reports
  let reports: UsageReport[] | null = null;
  try {
    reports = await live.session.fetchUsageReports();
  } catch {
    reports = null;
  }

  // 3. Assemble Components
  const components: any[] = [
    { id: "root", component: "Card", child: "col", shadow: "xs", p: "md", withBorder: true },
    { id: "col", component: "Column", children: ["header", "tabs"], gap: "md" },
    {
      id: "header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["title", "total-badge"],
    },
    { id: "title", component: "Text", text: "Session Telemetry & Usage", variant: "heading" },
    {
      id: "total-badge",
      component: "Badge",
      label: `Total: ${formatCost(totalCost)} · ${turnIndex} turns`,
      color: "cyan",
      size: "lg",
      variant: "light",
    },
    {
      id: "tabs",
      component: "Tabs",
      defaultValue: activeTab,
      tabs: [
        { title: "Cost & Tokens", child: "tab-cost" },
        { title: "Provider Quotas", child: "tab-quotas" },
        { title: "Performance & Latency", child: "tab-stats" },
      ],
    },

    // --- Tab 0: Cost & Tokens ---
    { id: "tab-cost", component: "Column", children: ["cost-metrics", "cost-charts"], gap: "md" },
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

    // --- Tab 1: Provider Quotas ---
    { id: "tab-quotas", component: "Column", children: ["quotas-list"], gap: "sm" },
    { id: "quotas-list", component: "Column", children: [] as string[], gap: "sm" },

    // --- Tab 2: Performance & Latency ---
    { id: "tab-stats", component: "Column", children: ["stats-metrics", "stats-charts"], gap: "md" },
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

  // Populate Provider Quotas Tab
  const quotasListComp = components.find(c => c.id === "quotas-list");
  if (!reports || reports.length === 0) {
    quotasListComp.children.push("quotas-empty-alert");
    components.push({
      id: "quotas-empty-alert",
      component: "Alert",
      title: "No Live Quota Endpoint",
      text: "The active provider or credentials do not expose live rate-limit quota endpoints (common for standard API key access). Token counts and cost metrics are tracked on the Cost & Tokens tab.",
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

      quotasListComp.children.push(pCardId);

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
        { id: limitsListId, component: "Column", children: [] as string[], gap: "xs" },
      );

      const limitsComp = components.find(c => c.id === limitsListId);

      for (let lIdx = 0; lIdx < report.limits.length; lIdx++) {
        const limit: UsageLimit = report.limits[lIdx]!;
        const lId = `p-${pIdx}-limit-${lIdx}`;
        const lRowId = `p-${pIdx}-lrow-${lIdx}`;
        const lLblId = `p-${pIdx}-lbl-${lIdx}`;
        const lAmtId = `p-${pIdx}-amt-${lIdx}`;
        const lProgId = `p-${pIdx}-prog-${lIdx}`;

        limitsComp.children.push(lId);

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
        limitsComp.children.push(creditId);
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
    surfaceId: METRICS_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}

export async function drawCostSurface(live: LiveSession): Promise<void> {
  await drawMetricsDashboard(live, "0");
}

export async function drawUsageSurface(live: LiveSession): Promise<void> {
  await drawMetricsDashboard(live, "1");
}

export async function drawStatsSurface(live: LiveSession): Promise<void> {
  await drawMetricsDashboard(live, "2");
}
