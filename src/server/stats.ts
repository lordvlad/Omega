/**
 * Token economics, performance metrics, and provider quota usage A2UI surfaces.
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

/**
 * /usage: Live provider quota limits, window countdowns, and reset credits.
 */
export async function drawUsageSurface(live: LiveSession): Promise<void> {
  let reports: UsageReport[] | null = null;
  try {
    reports = await live.session.fetchUsageReports();
  } catch {
    reports = null;
  }

  const surfaceId = "session-usage";

  if (!reports || reports.length === 0) {
    live.a2ui.recreateSurface({
      surfaceId,
      components: [
        { id: "root", component: "Card", child: "col", shadow: "xs", p: "md", withBorder: true },
        { id: "col", component: "Column", children: ["title", "info-alert"], gap: "md" },
        { id: "title", component: "Text", text: "Provider Usage & Rate Limits", variant: "heading" },
        {
          id: "info-alert",
          component: "Alert",
          title: "No Live Quota Endpoint",
          text: "The active provider or credentials do not expose live rate-limit quota endpoints (common for standard API key access). Run /cost to see session token economics instead.",
          color: "cyan",
          icon: "info",
        },
      ],
    });
    return;
  }

  const components: any[] = [
    { id: "root", component: "Card", child: "col", shadow: "xs", p: "md", withBorder: true },
    { id: "col", component: "Column", children: ["header", "providers-list"], gap: "md" },
    {
      id: "header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["title", "count-badge"],
    },
    { id: "title", component: "Text", text: "Provider Usage & Rate Limits", variant: "heading" },
    {
      id: "count-badge",
      component: "Badge",
      label: `${reports.length} ${reports.length === 1 ? "provider" : "providers"} active`,
      color: "cyan",
      size: "sm",
      variant: "light",
    },
    { id: "providers-list", component: "Column", children: [] as string[], gap: "sm" },
  ];

  const providerListComp = components.find(c => c.id === "providers-list");

  for (let pIdx = 0; pIdx < reports.length; pIdx++) {
    const report = reports[pIdx]!;
    const pCardId = `p-card-${pIdx}`;
    const pColId = `p-col-${pIdx}`;
    const pHeadId = `p-head-${pIdx}`;
    const pTitleId = `p-title-${pIdx}`;
    const pMetaId = `p-meta-${pIdx}`;

    providerListComp.children.push(pCardId);

    const providerName = formatProviderName(report.provider);
    const limitsListId = `p-limits-${pIdx}`;

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
        { id: lAmtId, component: "Text", text: `${pct}% used`, variant: "caption" },
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

  live.a2ui.recreateSurface({
    surfaceId,
    sendDataModel: false,
    components,
  });
}

/**
 * /cost: Session token breakdown, dollar cost, and cache savings.
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

  const surfaceId = "session-cost";

  live.a2ui.recreateSurface({
    surfaceId,
    sendDataModel: false,
    components: [
      { id: "root", component: "Card", child: "col", shadow: "xs", p: "md", withBorder: true },
      { id: "col", component: "Column", children: ["header", "metrics", "charts"], gap: "md" },
      {
        id: "header",
        component: "Row",
        justify: "spaceBetween",
        align: "center",
        children: ["title", "total-badge"],
      },
      { id: "title", component: "Text", text: "Session Token Economics & Cost", variant: "heading" },
      {
        id: "total-badge",
        component: "Badge",
        label: `Total: ${formatCost(totalCost)}`,
        color: "cyan",
        size: "lg",
        variant: "light",
      },

      {
        id: "metrics",
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
        id: "charts",
        component: "Row",
        children: ["c-cost", "c-tokens"],
        justify: "spaceBetween",
        align: "start",
      },

      {
        id: "c-cost",
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
        id: "c-tokens",
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
    ],
  });
}

/**
 * /stats: Session latency metrics, context-window growth, and tool invocation frequency.
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

  const surfaceId = "session-stats";

  live.a2ui.recreateSurface({
    surfaceId,
    sendDataModel: false,
    components: [
      { id: "root", component: "Card", child: "col", shadow: "xs", p: "md", withBorder: true },
      { id: "col", component: "Column", children: ["header", "metrics", "charts"], gap: "md" },
      {
        id: "header",
        component: "Row",
        justify: "spaceBetween",
        align: "center",
        children: ["title", "turns-badge"],
      },
      { id: "title", component: "Text", text: "Session Performance & Metrics", variant: "heading" },
      {
        id: "turns-badge",
        component: "Badge",
        label: `${turnIndex} turns · ${totalToolCalls} tool calls`,
        color: "cyan",
        size: "lg",
        variant: "light",
      },

      {
        id: "metrics",
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
        id: "charts",
        component: "Row",
        children: ["c-latency", "c-tools"],
        justify: "spaceBetween",
        align: "start",
      },

      {
        id: "c-latency",
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
        id: "c-tools",
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
        data: toolData,
        dataKey: "name",
        series: [{ name: "value", color: "plum", label: "Calls" }],
        height: 180,
        withTooltip: true,
      },
    ],
  });
}
