import { runGcCommand, type GcResult } from "@oh-my-pi/pi-coding-agent/cli/gc-cli";
/**
 * Storage Maintenance & Garbage Collection A2UI surface: /gc -> "session-gc".
 *
 * Runs storage maintenance across agent directories, sweeping unreferenced blobs,
 * checkpointing WAL databases, and archiving cold sessions.
 */
import { formatBytes } from "@oh-my-pi/pi-utils";
import { GC_SURFACE_ID, type A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";

/**
 * Perform storage maintenance and draw the GC surface (/gc -> "session-gc").
 */
export async function drawGcSurface(live: LiveSession, apply = true): Promise<GcResult> {
  const result = await runGcCommand({
    flags: {
      apply,
      blobs: true,
      archive: true,
      wal: true,
    },
  });

  const blobBytes = result.blobs?.bytes ?? 0;
  const blobsCleaned = result.blobs?.deleted ?? result.blobs?.wouldDelete ?? 0;
  const sessionsScanned = result.archive?.scanned ?? 0;
  const sessionsArchived = result.archive?.archived ?? result.archive?.wouldArchive ?? 0;
  const walDatabases = result.wal?.databases.length ?? 0;
  const walBytes = result.wal?.walBytes ?? 0;

  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "gc-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "gc-col",
      component: "Column",
      children: ["gc-header", "gc-metrics", "gc-details-card"],
      gap: "md",
    },
    {
      id: "gc-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["gc-title", "gc-badge"],
    },
    { id: "gc-title", component: "Text", text: "Storage Maintenance (/gc)", variant: "heading" },
    {
      id: "gc-badge",
      component: "Badge",
      label: apply ? "CLEANUP APPLIED" : "DRY RUN",
      color: apply ? "teal" : "yellow",
      size: "sm",
    },
    {
      id: "gc-metrics",
      component: "Row",
      children: ["m-reclaimed", "m-blobs", "m-sessions", "m-wal"],
      justify: "spaceBetween",
      gap: "sm",
    },
    {
      id: "m-reclaimed",
      component: "Card",
      child: "m-reclaimed-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    {
      id: "m-reclaimed-col",
      component: "Column",
      children: ["m-reclaimed-val", "m-reclaimed-lbl"],
      gap: 2,
      align: "center",
    },
    { id: "m-reclaimed-val", component: "Text", text: formatBytes(blobBytes), variant: "heading" },
    { id: "m-reclaimed-lbl", component: "Text", text: "Reclaimed Storage", variant: "caption" },

    {
      id: "m-blobs",
      component: "Card",
      child: "m-blobs-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    {
      id: "m-blobs-col",
      component: "Column",
      children: ["m-blobs-val", "m-blobs-lbl"],
      gap: 2,
      align: "center",
    },
    { id: "m-blobs-val", component: "Text", text: String(blobsCleaned), variant: "heading" },
    { id: "m-blobs-lbl", component: "Text", text: "Blobs Swept", variant: "caption" },

    {
      id: "m-sessions",
      component: "Card",
      child: "m-sessions-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    {
      id: "m-sessions-col",
      component: "Column",
      children: ["m-sessions-val", "m-sessions-lbl"],
      gap: 2,
      align: "center",
    },
    {
      id: "m-sessions-val",
      component: "Text",
      text: `${sessionsArchived}/${sessionsScanned}`,
      variant: "heading",
    },
    { id: "m-sessions-lbl", component: "Text", text: "Sessions Archived", variant: "caption" },

    {
      id: "m-wal",
      component: "Card",
      child: "m-wal-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
      weight: 1,
    },
    { id: "m-wal-col", component: "Column", children: ["m-wal-val", "m-wal-lbl"], gap: 2, align: "center" },
    {
      id: "m-wal-val",
      component: "Text",
      text: `${walDatabases} (${formatBytes(walBytes)})`,
      variant: "heading",
    },
    { id: "m-wal-lbl", component: "Text", text: "WAL Checkpoints", variant: "caption" },

    {
      id: "gc-details-card",
      component: "Card",
      child: "gc-details-col",
      shadow: "xs",
      p: "xs",
      withBorder: true,
    },
    {
      id: "gc-details-col",
      component: "Column",
      children: ["gc-details-title", "gc-table"],
      gap: "xs",
    },
    { id: "gc-details-title", component: "Text", text: "Maintenance Breakdown", variant: "body" },
    {
      id: "gc-table",
      component: "Table",
      headers: ["Subsystem", "Processed", "Reclaimed / Maintained", "Status"],
      rows: [
        [
          "Blob Store",
          `${result.blobs?.candidates ?? 0} candidates`,
          `${blobsCleaned} deleted (${formatBytes(blobBytes)})`,
          "CLEAN",
        ],
        [
          "Session Archive",
          `${sessionsScanned} scanned`,
          `${sessionsArchived} archived (${result.archive?.historyRowsDeleted ?? 0} rows)`,
          "OPTIMIZED",
        ],
        ["Database WAL", `${walDatabases} DBs`, `${formatBytes(walBytes)} checkpointed`, "CHECKPOINTED"],
        ["Agent Directory", result.agentDir, "Locks & cache verified", "OK"],
      ],
      striped: true,
      highlightOnHover: true,
    },
  ];

  live.a2ui.recreateSurface({
    surfaceId: GC_SURFACE_ID,
    sendDataModel: false,
    components,
  });

  return result;
}
