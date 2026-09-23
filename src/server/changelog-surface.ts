/**
 * Changelog A2UI surface: /changelog -> "session-changelog".
 *
 * Renders recent or full release notes from omp's bundled changelog,
 * parsed into categorized sections (Added, Changed, Fixed, Removed, Security)
 * with badges and structured bullets.
 */
import { getChangelogPath, parseChangelog } from "@oh-my-pi/pi-coding-agent/utils/changelog";

import { CHANGELOG_SURFACE_ID, type A2uiComponent } from "../shared/a2ui.ts";
import type { LiveSession } from "./registry.ts";

/** Default number of recent releases to render unless `/changelog full` is requested. */
const DEFAULT_RECENT_RELEASES = 3;
const DEFAULT_ITEMS_PER_SECTION = 5;

const CATEGORY_COLORS: Record<string, string> = {
  Added: "cyan",
  Changed: "plum",
  Fixed: "teal",
  Removed: "red",
  Deprecated: "yellow",
  Security: "orange",
  "Breaking Changes": "red",
};

interface ReleaseSection {
  category: string;
  items: string[];
}

/** Parse changelog release markdown content into structured category sections. */
function parseReleaseSections(content: string): ReleaseSection[] {
  const lines = content.split("\n");
  const sections: ReleaseSection[] = [];
  let currentCategory = "";
  let currentItems: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match ### Section headers
    const catMatch = /^###+\s*(Added|Changed|Fixed|Removed|Deprecated|Security|Breaking Changes.*)/i.exec(trimmed);
    if (catMatch) {
      if (currentCategory && currentItems.length > 0) {
        sections.push({ category: currentCategory, items: currentItems });
      }
      currentCategory = catMatch[1]!;
      currentItems = [];
      continue;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      currentItems.push(trimmed.slice(2).trim());
    } else if (currentItems.length > 0) {
      currentItems[currentItems.length - 1] += " " + trimmed;
    } else if (currentCategory) {
      currentItems.push(trimmed);
    }
  }

  if (currentCategory && currentItems.length > 0) {
    sections.push({ category: currentCategory, items: currentItems });
  }

  return sections;
}

/**
 * Draw the Changelog surface (/changelog -> "session-changelog").
 */
export async function drawChangelogSurface(live: LiveSession, full = false): Promise<void> {
  const changelogPath = getChangelogPath();
  const allEntries = await parseChangelog(changelogPath);

  if (allEntries.length === 0) {
    live.a2ui.recreateSurface({
      surfaceId: CHANGELOG_SURFACE_ID,
      sendDataModel: false,
      components: [
        { id: "root", component: "Card", child: "cl-empty-alert", shadow: "xs", p: "md", withBorder: true },
        {
          id: "cl-empty-alert",
          component: "Alert",
          title: "No Changelog Available",
          text: "No release notes could be resolved for the active omp build.",
          color: "cyan",
          icon: "info",
        },
      ],
    });
    return;
  }

  const entries = full ? allEntries : allEntries.slice(0, DEFAULT_RECENT_RELEASES);
  const latest = allEntries[0]!;
  const latestVersion = `v${latest.major}.${latest.minor}.${latest.patch}`;

  const releasesListChildren: string[] = [];
  const components: A2uiComponent[] = [
    { id: "root", component: "Card", child: "cl-col", shadow: "xs", p: "md", withBorder: true },
    {
      id: "cl-col",
      component: "Column",
      children: ["cl-header", "cl-releases-list"],
      gap: "md",
    },
    {
      id: "cl-header",
      component: "Row",
      justify: "spaceBetween",
      align: "center",
      children: ["cl-title", "cl-badge"],
    },
    { id: "cl-title", component: "Text", text: "Release Changelog", variant: "heading" },
    {
      id: "cl-badge",
      component: "Badge",
      label: full
        ? `Latest: ${latestVersion} · All ${allEntries.length} releases`
        : `Latest: ${latestVersion} · Showing ${entries.length} of ${allEntries.length}`,
      color: "cyan",
      size: "lg",
      variant: "light",
    },
    {
      id: "cl-releases-list",
      component: "Column",
      children: releasesListChildren,
      gap: "md",
    },
  ];

  for (let rIdx = 0; rIdx < entries.length; rIdx++) {
    const entry = entries[rIdx]!;
    const versionStr = `v${entry.major}.${entry.minor}.${entry.patch}`;
    const cardId = `rel-card-${rIdx}`;
    const colId = `rel-col-${rIdx}`;
    const headId = `rel-head-${rIdx}`;
    const verId = `rel-ver-${rIdx}`;
    const tagId = `rel-tag-${rIdx}`;
    const sectionsColId = `rel-sec-col-${rIdx}`;
    const sectionsColChildren: string[] = [];

    releasesListChildren.push(cardId);

    const sections = parseReleaseSections(entry.content);

    components.push(
      {
        id: cardId,
        component: "Paper",
        p: "sm",
        shadow: "xs",
        withBorder: true,
        child: colId,
      },
      {
        id: colId,
        component: "Column",
        children: [headId, sectionsColId],
        gap: "xs",
      },
      {
        id: headId,
        component: "Row",
        justify: "spaceBetween",
        align: "center",
        children: [verId, tagId],
      },
      { id: verId, component: "Text", text: versionStr, variant: "heading" },
      {
        id: tagId,
        component: "Badge",
        label: rIdx === 0 ? "LATEST RELEASE" : "RELEASE",
        color: rIdx === 0 ? "teal" : "gray",
        size: "xs",
        variant: rIdx === 0 ? "filled" : "outline",
      },
      {
        id: sectionsColId,
        component: "Column",
        children: sectionsColChildren,
        gap: "xs",
      },
    );

    if (sections.length === 0) {
      const emptyTextId = `rel-empty-${rIdx}`;
      sectionsColChildren.push(emptyTextId);
      components.push({
        id: emptyTextId,
        component: "Text",
        text: "Maintenance and performance improvements.",
        variant: "body",
      });
    } else {
      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const sec = sections[sIdx]!;
        const secBoxId = `rel-${rIdx}-sec-${sIdx}`;
        const secBadgeId = `rel-${rIdx}-badge-${sIdx}`;
        const secListId = `rel-${rIdx}-list-${sIdx}`;
        const secListChildren: string[] = [];

        sectionsColChildren.push(secBoxId);

        const itemsToShow = full ? sec.items : sec.items.slice(0, DEFAULT_ITEMS_PER_SECTION);
        const color = CATEGORY_COLORS[sec.category] ?? "cyan";

        components.push(
          {
            id: secBoxId,
            component: "Column",
            children: [secBadgeId, secListId],
            gap: 4,
          },
          {
            id: secBadgeId,
            component: "Badge",
            label: sec.category.toUpperCase(),
            color,
            size: "xs",
            variant: "light",
          },
          {
            id: secListId,
            component: "Column",
            children: secListChildren,
            gap: 2,
          },
        );

        for (let iIdx = 0; iIdx < itemsToShow.length; iIdx++) {
          const itemId = `rel-${rIdx}-sec-${sIdx}-item-${iIdx}`;
          secListChildren.push(itemId);
          components.push({
            id: itemId,
            component: "Text",
            text: `• ${itemsToShow[iIdx]!}`,
            variant: "body",
          });
        }

        if (!full && sec.items.length > DEFAULT_ITEMS_PER_SECTION) {
          const moreId = `rel-${rIdx}-sec-${sIdx}-more`;
          secListChildren.push(moreId);
          components.push({
            id: moreId,
            component: "Text",
            text: `+ ${sec.items.length - DEFAULT_ITEMS_PER_SECTION} more in /changelog full`,
            variant: "caption",
          });
        }
      }
    }
  }

  live.a2ui.recreateSurface({
    surfaceId: CHANGELOG_SURFACE_ID,
    sendDataModel: false,
    components,
  });
}
