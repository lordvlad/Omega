/**
 * Session usage statistics A2UI surface.
 */
import type { LiveSession } from "./registry.ts";

export async function drawStatsSurface(live: LiveSession): Promise<void> {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalTokens = 0;
  let totalCost = 0;

  const costSeries: { turn: number; cost: number; input: number; output: number }[] = [];
  const toolsCounts: Record<string, number> = {};
  const latencies: { turn: number; latencyMs: number }[] = [];

  let turnIndex = 0;

  for (const msg of live.session.messages) {
    if (msg.role === "assistant") {
      turnIndex++;
      let turnInput = 0;
      let turnOutput = 0;
      let turnCost = 0;

      if (msg.usage) {
        totalInput += msg.usage.input;
        totalOutput += msg.usage.output;
        totalCacheRead += msg.usage.cacheRead;
        totalCacheWrite += msg.usage.cacheWrite;
        totalTokens += msg.usage.totalTokens;

        if (msg.usage.cost) {
          totalCost += msg.usage.cost.total;
          turnInput = msg.usage.cost.input;
          turnOutput = msg.usage.cost.output;
          turnCost = msg.usage.cost.total;
        }
      }

      costSeries.push({
        turn: turnIndex,
        cost: Number(turnCost.toFixed(4)),
        input: Number(turnInput.toFixed(4)),
        output: Number(turnOutput.toFixed(4)),
      });

      if (msg.duration) {
        latencies.push({ turn: turnIndex, latencyMs: msg.duration });
      }

      for (const part of msg.content) {
        if (part.type === "toolCall") {
          toolsCounts[part.name] = (toolsCounts[part.name] || 0) + 1;
        }
      }
    }
  }

  const formatCost = (c: number) => {
    if (c < 0.01) return `$${c.toFixed(4)}`;
    if (c < 1) return `$${c.toFixed(3)}`;
    return `$${c.toFixed(2)}`;
  };

  const toolData = Object.entries(toolsCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value], i) => ({
      name,
      value,
      color: ["cyan", "plum", "teal", "yellow", "orange", "red", "gray", "blue", "green", "pink"][i % 10],
    }));

  live.a2ui.createSurface({
    surfaceId: `stats-${Date.now()}`,
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
      { id: "title", component: "Text", text: "Session Statistics & Token Usage", variant: "heading" },
      {
        id: "total-badge",
        component: "Badge",
        label: `Total Cost: ${formatCost(totalCost)}`,
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
        children: ["c-cost", "c-tools"],
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
          { name: "input", color: "cyan" },
          { name: "output", color: "plum" },
        ],
        height: 180,
        curveType: "monotone",
        withLegend: true,
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
      { id: "c-tools-title", component: "Text", text: "Top Tools Invoked", variant: "caption" },
      {
        id: "chart-tools",
        component: "DonutChart",
        data: toolData.length > 0 ? toolData : [{ name: "none", value: 1, color: "gray" }],
        size: 160,
        thickness: 16,
        withLabels: true,
        chartLabel: `${Object.values(toolsCounts).reduce((a, b) => a + b, 0)} calls`,
      },
    ],
  });
}
