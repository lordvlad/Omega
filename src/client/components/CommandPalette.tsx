/**
 * The command palette: one Spotlight over every navigation and session
 * command the shell offers.
 *
 * Modelled on omp's slash actions. With an empty query the palette lists the
 * commands themselves; picking one (or clicking a header hyperlink that
 * prefills it) narrows the palette to that command's items, and anything typed
 * after the command filters them:
 *
 *   /switch <term>   models the local install is authenticated for
 *   /cd <term>       every workspace and session, the way the nav tree listed them
 *   /resume <term>   sessions inside the workspace currently open
 *   /compact <focus> compact the context now, optionally with a summary focus
 *   /shake           drop tool results, large blocks, or images from context
 *   /think <term>    thinking level for this session
 *   /rename <title>  a new session title
 *   /branch <term>   restart the conversation from an earlier user message
 *   /stop <term>     live sessions, released from the server's memory
 *   /delete <term>   sessions, erased from disk with their artifacts
 *
 * `/retry`, `/abort`, `/plan`, `/new` and `/fork` take no argument, so they run
 * straight from the command list (and from typing the command and pressing
 * Enter, which is what their single-action lists are for).
 *
 * The command stays in the input, so the list on screen always explains itself.
 * A session row carries its own stop and delete controls. A Spotlight action is
 * a `<button>`, so those controls are `role="button"` spans rather than nested
 * buttons, and they stop propagation so hitting one does not also open the
 * session. Spotlight's keyboard navigation only reaches whole rows, so
 * `/stop` and `/delete` remain the keyboard path to the same two operations.
 */
import { ActionIcon, Badge, Group, Tooltip } from "@mantine/core";
import {
  isActionsGroup,
  Spotlight,
  spotlight,
  type SpotlightActionData,
  type SpotlightActionGroupData,
} from "@mantine/spotlight";
import {
  IconArchive,
  IconBell,
  IconBolt,
  IconBrain,
  IconChartBar,
  IconCoin,
  IconCornerDownLeft,
  IconCpu,
  IconFile,
  IconFilterX,
  IconFolder,
  IconFolderPlus,
  IconFolderSymlink,
  IconGitBranch,
  IconGitFork,
  IconHistory,
  IconMessage,
  IconMessageQuestion,
  IconPencil,
  IconPlayerStopFilled,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconRoute,
  IconSearch,
  IconSettings,
  IconShield,
  IconShieldCheck,
  IconStack2,
  IconTerminal2,
  IconTools,
  IconTrash,
} from "@tabler/icons-react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import type {
  BranchPoint,
  CompactRequest,
  LiveState,
  ModelOption,
  SessionSummary,
  SessionToolInfo,
  ShakeMode,
  SlashCommand,
  ThinkingLevel,
  Workspace,
} from "../api/model.ts";
import type { ProjectSettings } from "../lib/settings.ts";

/**
 * One-off compaction mode.
 *
 * Derived from the request type rather than imported: the generator inlines
 * the union of an optional property instead of naming it, so `CompactMode`
 * has no generated declaration to import.
 */
export type CompactMode = NonNullable<CompactRequest["mode"]>;

/** The palette commands, in the order the empty palette lists them. */
export const PALETTE_COMMAND = {
  model: "/switch",
  project: "/cd",
  session: "/resume",
  compact: "/compact",
  shake: "/shake",
  think: "/think",
  btw: "/btw",
  omfg: "/omfg",
  mcp: "/mcp",
  cost: "/cost",
  stats: "/stats",
  usage: "/usage",
  context: "/context",
  rename: "/rename",
  tools: "/tools",
  force: "/force",
  rules: "/rules",
  retry: "/retry",
  abort: "/abort",
  plan: "/plan",
  jobs: "/jobs",
  ps: "/ps",
  wt: "/wt",
  newSession: "/new",
  fork: "/fork",
  branch: "/branch",
  stop: "/stop",
  delete: "/delete",
  file: "@",
  settings: "/omega-settings",
} as const;
export type PaletteCommand = (typeof PALETTE_COMMAND)[keyof typeof PALETTE_COMMAND];

/** Either a single palette action or a labelled group of them. */
type PaletteAction = SpotlightActionData | SpotlightActionGroupData;

/**
 * Per-command palette behaviour.
 *
 * `run` commands take no argument, so their command-list entry acts
 * immediately instead of scoping the palette. `termIsInput` marks the commands
 * whose term is content rather than a filter — filtering by it would empty the
 * very list the user is typing into.
 */
const COMMAND_SPEC: Record<
  PaletteCommand,
  { kind: "scope" | "run"; placeholder: string; termIsInput?: true }
> = {
  "/switch": { kind: "scope", placeholder: "Filter models by name, provider, or capability…" },
  "/cd": { kind: "scope", placeholder: "Filter workspaces and sessions…" },
  "/resume": { kind: "scope", placeholder: "Filter sessions in this workspace…" },
  "/compact": {
    kind: "scope",
    placeholder: "Optional focus for the summary, then pick a mode…",
    termIsInput: true,
  },
  "/context": { kind: "scope", placeholder: "Reduce context size via /compact or /shake…" },
  "/shake": { kind: "scope", placeholder: "Pick what to drop from context…" },
  "/think": { kind: "scope", placeholder: "Filter thinking levels…" },
  "/btw": { kind: "scope", placeholder: "Type a side question to ask the model…", termIsInput: true },
  "/omfg": {
    kind: "scope",
    placeholder: "Describe what the agent got wrong to generate a rule…",
    termIsInput: true,
  },
  "/mcp": { kind: "scope", placeholder: "Manage and configure MCP servers…" },
  "/cost": { kind: "run", placeholder: "Render token economics and cost breakdown…" },
  "/stats": { kind: "run", placeholder: "Render session performance and latency stats…" },
  "/usage": { kind: "run", placeholder: "Render provider rate limits and quota usage…" },
  "/wt": { kind: "run", placeholder: "Inspect and manage git worktrees…" },
  "/rename": { kind: "scope", placeholder: "Type the new session title…", termIsInput: true },
  "/tools": { kind: "scope", placeholder: "Filter available tools or force one…" },
  "/force": { kind: "scope", placeholder: "Pick a tool to force for next turn…", termIsInput: true },
  "/rules": { kind: "scope", placeholder: "Filter stream rules (TTSR) or manage…" },
  "/jobs": { kind: "scope", placeholder: "Inspect background jobs or cancel…" },
  "/ps": { kind: "scope", placeholder: "Inspect supervised daemons, send signals, restart…" },
  "/retry": { kind: "run", placeholder: "Retry the last failed turn…" },
  "/abort": { kind: "run", placeholder: "Interrupt the current turn…" },
  "/plan": { kind: "run", placeholder: "Toggle plan mode…" },
  "/new": { kind: "run", placeholder: "Start a session in this workspace…" },
  "/fork": { kind: "run", placeholder: "Copy this session and continue in the copy…" },
  "/branch": { kind: "scope", placeholder: "Filter earlier messages to branch from…" },
  "/stop": { kind: "scope", placeholder: "Filter live sessions to stop…" },
  "/delete": { kind: "scope", placeholder: "Filter sessions to delete from disk…" },
  "@": { kind: "scope", placeholder: "Filter files in this workspace…" },
  "/omega-settings": { kind: "scope", placeholder: "Toggle workspace and notification settings…" },
};

/** Thinking levels omp offers, ascending, matching the `ThinkingLevel` union. */
const THINKING_LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** Compaction modes, with omp's own description of what each one does. */
const COMPACT_MODES: Array<{ mode: CompactMode; description: string }> = [
  { mode: "soft", description: "Summarize locally with the active model (skip server compaction)" },
  { mode: "remote", description: "Summarize via server compaction, then fall back to a local summary" },
  {
    mode: "snapcompact",
    description: "Archive history onto dense bitmap images the model reads back (no LLM call)",
  },
];

/** Shake modes and the content each one strips. */
const SHAKE_MODES: Array<{ mode: ShakeMode; description: string }> = [
  { mode: "elide", description: "Strip tool results and large blocks" },
  { mode: "images", description: "Strip image blocks" },
];

/** Descriptions that depend on nothing, shared by a command entry and its list. */
const RETRY_DESCRIPTION = "Re-run the last failed or aborted turn";
const FORK_DESCRIPTION = "Copy this session, transcript and all, and continue in the copy";

/**
 * Prefill the palette with `command` and show it.
 *
 * Every header hyperlink and every command entry goes through here, so the
 * trailing space that separates a command from its filter term is written once.
 */
export function openPalette(command: PaletteCommand, setQuery: (query: string) => void): void {
  setQuery(command === "@" ? "@" : `${command} `);
  spotlight.open();
}

/** Show the palette for fuzzy file mentions. */
export function openPaletteFiles(setQuery: (query: string) => void): void {
  setQuery("@");
  spotlight.open();
}

interface ParsedQuery {
  /** The recognised command, or `undefined` while the palette lists commands. */
  command?: PaletteCommand;
  /** Everything typed after the command; the raw query when there is none. */
  term: string;
}

/**
 * Show the palette on its whole command list.
 *
 * The query is a bare `/` rather than empty: it is what the user typed to get
 * here, every command label starts with one so nothing is filtered out, and
 * leaving it in place means the next keystroke narrows the list instead of
 * starting a search that has to be retyped.
 */
export function openPaletteCommands(setQuery: (query: string) => void): void {
  setQuery("/");
  spotlight.open();
}

/**
 * Split `/cd src/client` into its command and its filter term.
 *
 * An unrecognised leading slash word is *not* a command: the palette keeps
 * listing commands so the typo stays visible and correctable.
 */
function parseQuery(query: string): ParsedQuery {
  const trimmed = query.trimStart();
  if (trimmed.startsWith("@")) {
    return { command: "@", term: trimmed.slice(1).trimStart() };
  }
  const match = /^(\/[a-zA-Z-]+)(?:\s+([\s\S]*))?$/.exec(trimmed);
  const word = match?.[1];
  if (!word || !Object.hasOwn(COMMAND_SPEC, word)) return { term: query };
  return { command: word as PaletteCommand, term: match?.[2] ?? "" };
}

/**
 * Score a candidate file path against search query tokens.
 * Higher score = much better match. Returns 0 if it doesn't match.
 *
 * Prioritizes exact filename matches, filename prefixes, and camelCase /
 * word boundaries, while penalizing scattered subsequences and preventing
 * 1-2 character queries from matching thousands of irrelevant files.
 */
function scoreFileMatch(filePath: string, query: string): number {
  if (!query) return 1;
  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return 1;

  const parts = filePath.split("/");
  const fileName = parts[parts.length - 1] ?? filePath;
  const lowerName = fileName.toLowerCase();
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  const nameWithoutExt = ext ? lowerName.slice(0, -ext.length) : lowerName;

  // 1. Exact matches (highest priority)
  if (lowerName === lowerQuery || nameWithoutExt === lowerQuery) {
    return 2000;
  }
  if (lowerPath === lowerQuery) {
    return 1800;
  }

  // 2. Exact prefix matches in filename
  if (lowerName.startsWith(lowerQuery) || nameWithoutExt.startsWith(lowerQuery)) {
    return 1500 - (fileName.length - lowerQuery.length);
  }

  // 3. Word boundary / CamelCase matches in filename (e.g. "CP" -> "CommandPalette", "FT" -> "FileTree")
  const wordStarts = fileName
    .split(/[-_./\s]+|(?=[A-Z])/)
    .filter(Boolean)
    .map(w => w[0]?.toLowerCase())
    .join("");
  if (wordStarts.includes(lowerQuery) || wordStarts.startsWith(lowerQuery)) {
    return 1200 + (wordStarts.startsWith(lowerQuery) ? 200 : 0);
  }

  // 4. Contiguous substring in filename
  const nameSubIndex = lowerName.indexOf(lowerQuery);
  if (nameSubIndex !== -1) {
    return 1000 - nameSubIndex * 10 - (fileName.length - lowerQuery.length);
  }

  // 5. Path prefix or segment match (e.g. "server/" or "client/components")
  if (lowerPath.startsWith(lowerQuery)) {
    return 800 - (lowerPath.length - lowerQuery.length);
  }
  const pathSubIndex = lowerPath.indexOf(lowerQuery);
  if (pathSubIndex !== -1) {
    return 600 - pathSubIndex * 5;
  }

  // For very short queries (1 or 2 characters), require contiguous match to avoid noise.
  if (lowerQuery.length <= 2) {
    return 0;
  }

  // 6. Compact fuzzy subsequence in filename (with gap penalties)
  let nameScore = 0;
  let namePIdx = 0;
  let consecutive = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let i = 0; i < lowerName.length && namePIdx < lowerQuery.length; i++) {
    if (lowerName[i] === lowerQuery[namePIdx]) {
      if (firstMatch === -1) firstMatch = i;
      lastMatch = i;
      namePIdx++;
      consecutive++;
      nameScore += 10 + consecutive * 5;
    } else {
      consecutive = 0;
    }
  }

  if (namePIdx === lowerQuery.length) {
    const span = lastMatch - firstMatch + 1;
    return Math.max(350 + nameScore - span * 5, 50);
  }

  // 7. Compact fuzzy subsequence in full path (for query length >= 3)
  let pathScore = 0;
  let pathPIdx = 0;
  let pathConsecutive = 0;
  let pFirst = -1;
  let pLast = -1;

  for (let i = 0; i < lowerPath.length && pathPIdx < lowerQuery.length; i++) {
    if (lowerPath[i] === lowerQuery[pathPIdx]) {
      if (pFirst === -1) pFirst = i;
      pLast = i;
      pathPIdx++;
      pathConsecutive++;
      pathScore += 5 + pathConsecutive * 3;
    } else {
      pathConsecutive = 0;
    }
  }

  if (pathPIdx === lowerQuery.length) {
    const span = pLast - pFirst + 1;
    return Math.max(100 + pathScore - span * 2, 10);
  }

  return 0;
}
/** Every whitespace-separated token must appear somewhere in the haystack. */
function matches(action: SpotlightActionData, tokens: string[]): boolean {
  const keywords = Array.isArray(action.keywords) ? action.keywords.join(" ") : (action.keywords ?? "");
  const haystack = `${action.label ?? ""} ${action.description ?? ""} ${keywords}`.toLowerCase();
  return tokens.every(token => haystack.includes(token));
}

/** Coarse "how long ago", matching the wording the session tree used. */
function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface CommandPaletteProps {
  /** Controlled query, so a header hyperlink can prefill a command. */
  query: string;
  onQueryChange: (query: string) => void;
  models: ModelOption[];
  recentModels: string[];
  workspaces: Workspace[];
  activeProject?: string;
  /** Session key from the URL; `/switch` needs a live session to act on. */
  sessionKey?: string;
  /** Live session state, once loaded; the command descriptions report from it. */
  state: LiveState | undefined;
  /** User messages `/branch` can restart from, oldest first. */
  branchPoints: BranchPoint[];
  onSelectModel: (ref: string) => void;
  onSelectProject: (cwd: string) => void;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession: (cwd: string) => void;
  onAddWorkspace: () => void;
  /** Compact context now; `undefined` mode uses the configured method order. */
  onCompact: (mode: CompactMode | undefined, focus: string) => void;
  onShake: (mode: ShakeMode) => void;
  onSetThinking: (level: ThinkingLevel) => void;
  onBtw?: (question: string) => void;
  onOmfg?: (complaint: string) => void;
  onRename: (title: string) => void;
  onOpenMcp?: () => void;
  onOpenTools?: () => void;
  onOpenRules?: () => void;
  onForceTool?: (tool: string) => void;
  toolsList?: SessionToolInfo[];
  forcedTool?: string;
  onRetry: () => void;
  onShowCost?: () => void;
  onShowUsage?: () => void;
  onShowStats?: () => void;
  onShowWorktree?: () => void;
  onAbort: () => void;
  onTogglePlanMode: (enabled: boolean) => void;
  onFork: () => void;
  onBranch: (point: BranchPoint) => void;
  onOpenJobs?: () => void;
  onOpenProcesses?: () => void;
  /** Release a live session from the server's memory; the file is kept. */
  onStopSession: (session: SessionSummary) => void;
  /** Erase a session and its artifacts from disk. Confirms before acting. */
  onDeleteSession: (session: SessionSummary) => void;
  /** Slash commands MCP servers published for this session. */
  mcpCommands: SlashCommand[];
  /**
   * Chosen an MCP command: the name without its slash.
   *
   * Picking writes it into the composer rather than sending it, because these
   * commands take arguments and the palette cannot know which ones — and
   * because a prompt that fires on a single keystroke, with no chance to read
   * it back, is not a thing to build.
   */
  onPickCommand: (name: string) => void;
  /**
   * Re-read the workspace listing.
   *
   * The palette is the only place sessions are listed now, and a session
   * started in a terminal appears on disk without the client hearing about
   * it, so opening the palette is the natural moment to refetch.
   */
  onRefreshWorkspaces: () => void;
  /** Workspace files available for `@` mentions. */
  files?: string[];
  /** Picked a file for an `@` mention. */
  onPickFile?: (file: string) => void;
  /** Per-project display toggles, edited via `/omega-settings`. */
  settings: ProjectSettings;
  onToggleSetting: (key: keyof ProjectSettings) => void;
}

export function CommandPalette({
  query,
  onQueryChange,
  models,
  recentModels,
  workspaces,
  activeProject,
  sessionKey,
  state,
  branchPoints,
  onSelectModel,
  onSelectProject,
  onOpenSession,
  onNewSession,
  onAddWorkspace,
  onCompact,
  onShake,
  onSetThinking,
  onRename,
  onRetry,
  onAbort,
  onTogglePlanMode,
  onBtw,
  onOpenMcp,
  onOpenTools,
  onOpenRules,
  onForceTool,
  toolsList,
  forcedTool,
  onShowCost,
  onShowUsage,
  onShowStats,
  onShowWorktree,
  onOmfg,
  onFork,
  onBranch,
  onStopSession,
  onDeleteSession,
  onOpenJobs,
  onOpenProcesses,
  mcpCommands,
  onPickCommand,
  onRefreshWorkspaces,
  files = [],
  onPickFile,
  settings,
  onToggleSetting,
}: CommandPaletteProps) {
  const { command, term } = parseQuery(query);
  /** Sessions currently held open by the server, newest workspace first. */
  const liveSessions = useMemo(
    () =>
      workspaces.flatMap(workspace =>
        workspace.sessions.filter(session => session.live).map(session => ({ workspace, session })),
      ),
    [workspaces],
  );
  /** Helper to close and clear spotlight when opening an application drawer. */
  const handleOpenDrawer = useCallback(
    (openFn?: () => void) => {
      spotlight.close();
      onQueryChange("");
      openFn?.();
    },
    [onQueryChange],
  );

  /**
   * One session row, as `/cd` and `/resume` list it.
   *
   * Whether the server holds the session open is the one thing a row cannot
   * say in words without being read twice, so it is a badge; stopping and
   * deleting are right there rather than a command away.
   */
  const sessionRow = useCallback(
    (session: SessionSummary, idPrefix: string, keywords: string[]): SpotlightActionData => ({
      id: `${idPrefix}${session.path}`,
      label: session.title || session.firstMessage || "Untitled session",
      description: `${session.status} · ${session.messageCount} msg · ${relative(session.modified)}`,
      keywords: [...keywords, session.id, session.live ? "active" : "dormant"],
      leftSection: <IconMessage size={16} />,
      rightSection: (
        <Group gap={4} wrap="nowrap">
          <Badge
            size="xs"
            variant={session.live ? "filled" : "light"}
            color={session.live ? "cyan" : "slate"}
          >
            {session.live ? "active" : "dormant"}
          </Badge>
          {session.live ? (
            <Tooltip label="Stop: release the live agent, keep the file" position="left">
              <ActionIcon
                component="span"
                role="button"
                aria-label="Stop this session"
                size="sm"
                variant="subtle"
                color="orange"
                onClick={event => {
                  event.stopPropagation();
                  onStopSession(session);
                }}
              >
                <IconPlayerStopFilled size={13} />
              </ActionIcon>
            </Tooltip>
          ) : null}
          <Tooltip label="Delete this session from disk" position="left">
            <ActionIcon
              component="span"
              role="button"
              aria-label="Delete this session"
              size="sm"
              variant="subtle"
              color="red"
              onClick={event => {
                event.stopPropagation();
                onDeleteSession(session);
              }}
            >
              <IconTrash size={13} />
            </ActionIcon>
          </Tooltip>
        </Group>
      ),
      onClick: () => onOpenSession(session),
    }),
    [onOpenSession, onStopSession, onDeleteSession],
  );

  const planEnabled = state?.plan?.enabled === true;

  /** Descriptions shared by a command's list entry and its single-action list. */
  const abortDescription = state?.streaming === true ? "Interrupt the turn in flight" : "Nothing is running";
  const planDescription = `${planEnabled ? "Disable" : "Enable"} plan mode`;
  const newDescription = activeProject ? `Start a session in ${activeProject}` : "Pick a workspace first";

  /** The command list: what the palette shows before a command is chosen. */
  /** `@`: every file in the active workspace. */
  const fileActions = useMemo<PaletteAction[]>(() => {
    if (!files || files.length === 0) return [];
    return [
      {
        group: `Files in workspace (${files.length})`,
        actions: files.map(file => {
          const parts = file.split("/");
          const fileName = parts.pop() ?? file;
          const dir = parts.join("/");
          return {
            id: `file-${file}`,
            label: file,
            description: dir ? `in ${dir}` : "workspace root",
            keywords: [fileName, dir, file],
            leftSection: <IconFile size={16} />,
            onClick: () => onPickFile?.(file),
          };
        }),
      },
    ];
  }, [files, onPickFile]);
  const commandActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Commands",
        actions: [
          {
            id: "command-switch",
            label: PALETTE_COMMAND.model,
            description: sessionKey ? "Change the model for this session" : "Open a session first",
            keywords: "model provider switch",
            leftSection: <IconCpu size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.model} `),
          },
          {
            id: "command-cd",
            label: PALETTE_COMMAND.project,
            description: "Switch workspace, or open any session",
            keywords: "project workspace directory cd",
            leftSection: <IconFolder size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.project} `),
          },
          {
            id: "command-resume",
            label: PALETTE_COMMAND.session,
            description: activeProject ? `Resume a session in ${activeProject}` : "Pick a workspace first",
            keywords: "session resume history",
            leftSection: <IconHistory size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.session} `),
          },
          {
            id: "command-compact",
            label: PALETTE_COMMAND.compact,
            description: `Summarize the conversation${state?.contextUsage ? ` · ${Math.round(state.contextUsage.percent)}% of context used` : ""}`,
            keywords: "compact summarize context shrink",
            leftSection: <IconArchive size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.compact} `),
          },
          {
            id: "command-shake",
            label: PALETTE_COMMAND.shake,
            description: "Drop tool results, large blocks, or images from context",
            keywords: "shake elide images drop context",
            leftSection: <IconFilterX size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.shake} `),
          },
          {
            id: "command-think",
            label: PALETTE_COMMAND.think,
            description: `Thinking level · currently ${state?.thinkingLevel ?? "unknown"}`,
            keywords: "thinking reasoning effort budget",
            leftSection: <IconBrain size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.think} `),
          },
          {
            id: "command-rename",
            label: PALETTE_COMMAND.rename,
            description: `Rename this session${state?.title ? ` (now “${state.title}”)` : ""}`,
            keywords: "rename title name",
            leftSection: <IconPencil size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.rename} `),
          },
          {
            id: "command-retry",
            label: PALETTE_COMMAND.retry,
            description: RETRY_DESCRIPTION,
            keywords: "retry again failed",
            leftSection: <IconRefresh size={16} />,
            onClick: onRetry,
          },
          {
            id: "command-btw",
            label: PALETTE_COMMAND.btw,
            description: "Ask a transient side-question without polluting history",
            keywords: "btw side question ask ephemeral",
            leftSection: <IconMessageQuestion size={16} color="var(--mantine-color-cyan-4)" />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.btw} `),
          },
          {
            id: "command-omfg",
            label: PALETTE_COMMAND.omfg,
            description: "Create a rule (TTSR) from a recurring mistake in this session",
            keywords: "omfg rule mistake fix ttsr stream",
            leftSection: <IconShield size={16} color="var(--mantine-color-orange-4)" />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.omfg} `),
          },
          {
            id: "command-mcp-manage",
            label: PALETTE_COMMAND.mcp,
            description: "Manage MCP servers, test connections, and configure tools",
            keywords: "mcp servers plugins tools manage add test",
            leftSection: <IconPlugConnected size={16} color="var(--mantine-color-cyan-4)" />,
            onClick: () => handleOpenDrawer(onOpenMcp),
          },
          {
            id: "command-abort",
            label: PALETTE_COMMAND.abort,
            description: abortDescription,
            keywords: "abort interrupt stop escape cancel",
            leftSection: <IconPlayerStopFilled size={16} />,
            onClick: onAbort,
          },
          {
            id: "command-cost",
            label: PALETTE_COMMAND.cost,
            description: "Render token economics, burn rate, and cost breakdown",
            keywords: "cost tokens economics breakdown burn expense",
            leftSection: <IconCoin size={16} color="var(--mantine-color-yellow-4)" />,
            closeSpotlightOnTrigger: true,
            onClick: () => onShowCost?.(),
          },
          {
            id: "command-usage",
            label: PALETTE_COMMAND.usage,
            description: "Render provider rate limits and quota window usage",
            keywords: "usage quota provider rate limits capacity",
            leftSection: <IconCpu size={16} color="var(--mantine-color-plum-4)" />,
            closeSpotlightOnTrigger: true,
            onClick: () => onShowUsage?.(),
          },
          {
            id: "command-stats",
            label: PALETTE_COMMAND.stats,
            description: "Render session latency and tool usage dashboard",
            keywords: "stats metrics latency performance dashboard tool calls",
            leftSection: <IconChartBar size={16} color="var(--mantine-color-cyan-4)" />,
            closeSpotlightOnTrigger: true,
            onClick: () => onShowStats?.(),
          },
          {
            id: "command-wt",
            label: PALETTE_COMMAND.wt,
            description: "Inspect and manage git worktrees across project and task isolation",
            keywords: "worktree wt git branch checkout isolate",
            leftSection: <IconGitBranch size={16} color="var(--mantine-color-teal-4)" />,
            closeSpotlightOnTrigger: true,
            onClick: () => onShowWorktree?.(),
          },
          {
            id: "command-plan",
            label: PALETTE_COMMAND.plan,
            description: planDescription,
            keywords: "plan mode planning research",
            leftSection: <IconRoute size={16} />,
            onClick: () => onTogglePlanMode(!planEnabled),
          },
          {
            id: "command-new",
            label: PALETTE_COMMAND.newSession,
            description: newDescription,
            keywords: "new session start",
            leftSection: <IconPlus size={16} />,
            disabled: !activeProject,
            onClick: () => {
              if (activeProject) onNewSession(activeProject);
            },
          },
          {
            id: "command-fork",
            label: PALETTE_COMMAND.fork,
            description: FORK_DESCRIPTION,
            keywords: "fork copy duplicate branch",
            leftSection: <IconGitFork size={16} />,
            onClick: onFork,
          },
          {
            id: "command-tools",
            label: PALETTE_COMMAND.tools,
            description: "Inspect available tools across built-in, custom, MCP, and xdev",
            keywords: "tools inspect mcp custom xdev parameters schema",
            leftSection: <IconTools size={16} color="var(--mantine-color-teal-4)" />,
            onClick: () => handleOpenDrawer(onOpenTools),
          },
          {
            id: "command-force",
            label: PALETTE_COMMAND.force,
            description: "Force the agent to use a specific tool on the next turn",
            keywords: "force tool choice override hammer",
            leftSection: <IconBolt size={16} color="var(--mantine-color-cyan-4)" />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.force} `),
          },
          {
            id: "command-rules",
            label: PALETTE_COMMAND.rules,
            description: "View and manage active stream rules (TTSR) across project and global",
            keywords: "rules stream ttsr regex conditions manage",
            leftSection: <IconShieldCheck size={16} color="var(--mantine-color-orange-4)" />,
            onClick: () => handleOpenDrawer(onOpenRules),
          },
          {
            id: "command-jobs",
            label: PALETTE_COMMAND.jobs,
            description: "Inspect active background jobs and worker pools",
            keywords: "jobs background async workers subagents cancel",
            leftSection: <IconStack2 size={16} color="var(--mantine-color-cyan-4)" />,
            onClick: () => handleOpenDrawer(onOpenJobs),
          },
          {
            id: "command-ps",
            label: PALETTE_COMMAND.ps,
            description: "Manage supervised processes, send signals, and inspect daemons",
            keywords: "ps processes daemons services supervisor signal restart stop",
            leftSection: <IconTerminal2 size={16} color="var(--mantine-color-teal-4)" />,
            onClick: () => handleOpenDrawer(onOpenProcesses),
          },
          {
            id: "command-branch",
            description:
              branchPoints.length > 0
                ? `Restart from one of ${branchPoints.length} earlier messages`
                : "No user messages to branch from",
            keywords: "branch rewind edit message",
            leftSection: <IconGitBranch size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.branch} `),
          },
          {
            id: "command-stop",
            label: PALETTE_COMMAND.stop,
            description:
              liveSessions.length > 0
                ? `Release a live session (${liveSessions.length} running)`
                : "No sessions are live",
            keywords: "stop halt release live",
            leftSection: <IconPlayerStopFilled size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.stop} `),
          },
          {
            id: "command-delete",
            label: PALETTE_COMMAND.delete,
            description: "Delete a session and its artifacts from disk",
            keywords: "delete remove rm erase",
            leftSection: <IconTrash size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.delete} `),
          },
          {
            id: "command-file",
            label: PALETTE_COMMAND.file,
            description: activeProject ? `Mention a file from ${activeProject}` : "Pick a workspace first",
            keywords: "file mention disk workspace path @",
            leftSection: <IconFile size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange("@"),
          },
          {
            id: "command-settings",
            label: PALETTE_COMMAND.settings,
            description: "Toggle workspace display and notification settings",
            keywords: "settings preferences thinking tool calls notifications notify yield show hide",
            leftSection: <IconSettings size={16} />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.settings} `),
          },
        ],
      },
      // Listed after the built-ins and only when a server actually published
      // something, so a session without MCP shows no empty heading.
      ...(mcpCommands.length > 0
        ? [
            {
              group: "MCP",
              actions: mcpCommands.map(command => ({
                id: `mcp-${command.name}`,
                label: `/${command.name}`,
                description: command.description,
                // The server name is half of `server:prompt`, so it is already
                // searchable; the rest lets "mcp" or "prompt" find them all.
                keywords: `mcp prompt ${command.name.replace(/[:_-]+/gu, " ")}`,
                leftSection: <IconPlugConnected size={16} />,
                onClick: () => onPickCommand(command.name),
              })),
            },
          ]
        : []),
    ],
    [
      sessionKey,
      activeProject,
      liveSessions,
      onQueryChange,
      state,
      branchPoints,
      planEnabled,
      abortDescription,
      planDescription,
      newDescription,
      onRetry,
      onAbort,
      onTogglePlanMode,
      onNewSession,
      onFork,
      mcpCommands,
      onPickCommand,
      handleOpenDrawer,
      onOpenMcp,
      onOpenTools,
      onOpenRules,
      onOpenJobs,
      onOpenProcesses,
      onShowWorktree,
    ],
  );

  /** `/switch`: recently used models first, then every model by provider. */
  const modelActions = useMemo<PaletteAction[]>(() => {
    const modelMap = new Map(models.map(model => [model.ref, model]));
    const groups: PaletteAction[] = [];

    const entry = (model: ModelOption, idPrefix: string): SpotlightActionData => ({
      id: `${idPrefix}${model.ref}`,
      label: model.name,
      description: `${model.provider}${model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} tokens` : ""}${model.reasoning ? " · reasoning" : ""}`,
      keywords: [model.ref, model.provider, model.id, model.reasoning ? "reasoning" : ""],
      leftSection: model.reasoning ? <IconBrain size={16} /> : <IconCpu size={16} />,
      onClick: () => onSelectModel(model.ref),
    });

    const recent = recentModels
      .map(ref => modelMap.get(ref))
      .filter((model): model is ModelOption => Boolean(model))
      .slice(0, 5);
    if (recent.length > 0) {
      groups.push({ group: "Recently used", actions: recent.map(model => entry(model, "recent-")) });
    }

    const byProvider = new Map<string, ModelOption[]>();
    for (const model of models) {
      const list = byProvider.get(model.provider);
      if (list) list.push(model);
      else byProvider.set(model.provider, [model]);
    }
    for (const [provider, list] of [...byProvider].sort((a, b) => a[0].localeCompare(b[0]))) {
      groups.push({ group: provider, actions: list.map(model => entry(model, "")) });
    }

    return groups;
  }, [models, recentModels, onSelectModel]);

  /** `/cd`: every workspace with its sessions under it, as the nav tree had them. */
  const projectActions = useMemo<PaletteAction[]>(() => {
    const groups: PaletteAction[] = workspaces.map(workspace => ({
      group: `${workspace.name} — ${workspace.cwd}`,
      actions: [
        {
          id: `cd-${workspace.cwd}`,
          label: workspace.name,
          description: `${workspace.cwd} · ${workspace.sessions.length} session${workspace.sessions.length === 1 ? "" : "s"}`,
          keywords: [workspace.cwd, "workspace", "project", "cd"],
          leftSection: <IconFolderSymlink size={16} />,
          onClick: () => onSelectProject(workspace.cwd),
        },
        {
          id: `new-${workspace.cwd}`,
          label: "New session",
          description: workspace.exists ? workspace.cwd : `${workspace.cwd} (directory is gone)`,
          keywords: [workspace.cwd, workspace.name, "new", "start"],
          leftSection: <IconPlus size={16} />,
          disabled: !workspace.exists,
          onClick: () => onNewSession(workspace.cwd),
        },
        ...workspace.sessions.map(session =>
          sessionRow(session, "session-", [workspace.cwd, workspace.name]),
        ),
      ],
    }));

    groups.push({
      group: "Workspaces",
      actions: [
        {
          id: "add-workspace",
          label: "Open a directory…",
          description: "Start a session in a directory omp has not used yet",
          keywords: "add workspace directory folder open",
          leftSection: <IconFolderPlus size={16} />,
          onClick: onAddWorkspace,
        },
      ],
    });

    return groups;
  }, [workspaces, onSelectProject, onNewSession, onAddWorkspace, sessionRow]);

  /** `/resume`: only the sessions of the workspace currently open. */
  const sessionActions = useMemo<PaletteAction[]>(() => {
    const workspace = workspaces.find(candidate => candidate.cwd === activeProject);
    if (!workspace) return [];
    return [
      {
        group: workspace.cwd,
        actions: [
          {
            id: `resume-new-${workspace.cwd}`,
            label: "New session",
            description: workspace.exists ? workspace.cwd : `${workspace.cwd} (directory is gone)`,
            keywords: "new start",
            leftSection: <IconPlus size={16} />,
            disabled: !workspace.exists,
            onClick: () => onNewSession(workspace.cwd),
          },
          ...workspace.sessions.map(session => sessionRow(session, "resume-", [])),
        ],
      },
    ];
  }, [workspaces, activeProject, onNewSession, sessionRow]);

  /**
   * `/compact`: the configured method order first, then each one-off mode.
   *
   * The term is the summary focus rather than a filter, so it is passed
   * through to the handler. `snapcompact` writes no summary and the server
   * rejects a focus with it, so it is disabled while focus text is present.
   */
  const compactActions = useMemo<PaletteAction[]>(() => {
    const focus = term.trim();
    return [
      {
        group: "Compact context",
        actions: [
          {
            id: "compact-default",
            label: "Compact now",
            description: "Configured method order",
            keywords: "compact summarize default",
            leftSection: <IconArchive size={16} />,
            onClick: () => onCompact(undefined, term),
          },
          ...COMPACT_MODES.map(({ mode, description }) => ({
            id: `compact-${mode}`,
            label: mode,
            description: mode === "snapcompact" && focus.length > 0 ? "Takes no focus text" : description,
            keywords: [mode, "compact"],
            leftSection: <IconArchive size={16} />,
            disabled: mode === "snapcompact" && focus.length > 0,
            onClick: () => onCompact(mode, term),
          })),
        ],
      },
    ];
  }, [term, onCompact]);

  /** `/shake`: the two kinds of heavy content omp can strip. */
  const shakeActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Shake context",
        actions: SHAKE_MODES.map(({ mode, description }) => ({
          id: `shake-${mode}`,
          label: mode,
          description,
          keywords: [mode, "shake", "drop"],
          leftSection: <IconFilterX size={16} />,
          onClick: () => onShake(mode),
        })),
      },
    ],
    [onShake],
  );

  /** `/think`: every thinking level, with the active one marked. */
  const thinkActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Thinking level",
        actions: THINKING_LEVELS.map(level => ({
          id: `think-${level}`,
          label: level,
          description: level === state?.thinkingLevel ? "Current level" : "Set for this session",
          keywords: "thinking reasoning effort",
          leftSection: <IconBrain size={16} />,
          onClick: () => onSetThinking(level),
        })),
      },
    ],
    [state?.thinkingLevel, onSetThinking],
  );

  /**
   * `/omega-settings`: transcript display toggles for this workspace.
   *
   * Stays open on click, unlike most single-choice scopes — these are
   * independent switches, not a pick-one-and-go list, so toggling one is
   * worth seeing reflected before the palette closes.
   */
  const settingsActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Workspace settings",
        actions: [
          {
            id: "settings-show-thinking",
            label: "Show thinking",
            description: settings.showThinking ? "Shown in the transcript" : "Hidden from the transcript",
            keywords: "thinking reasoning show hide",
            leftSection: <IconBrain size={16} />,
            rightSection: (
              <Badge size="xs" variant={settings.showThinking ? "filled" : "light"} color="plum">
                {settings.showThinking ? "On" : "Off"}
              </Badge>
            ),
            closeSpotlightOnTrigger: false,
            onClick: () => onToggleSetting("showThinking"),
          },
          {
            id: "settings-show-tool-calls",
            label: "Show tool calls",
            description: settings.showToolCalls ? "Shown in the transcript" : "Hidden from the transcript",
            keywords: "tool calls bash commands show hide",
            leftSection: <IconTerminal2 size={16} />,
            rightSection: (
              <Badge size="xs" variant={settings.showToolCalls ? "filled" : "light"} color="plum">
                {settings.showToolCalls ? "On" : "Off"}
              </Badge>
            ),
            closeSpotlightOnTrigger: false,
            onClick: () => onToggleSetting("showToolCalls"),
          },
          {
            id: "settings-notify-on-yield",
            label: "Notify on yield",
            description: settings.notifyOnYield
              ? "Browser notification when agent yields or completes turn"
              : "No browser notifications on yield",
            keywords: "notifications notify yield finish alert sound browser desktop",
            leftSection: <IconBell size={16} />,
            rightSection: (
              <Badge size="xs" variant={settings.notifyOnYield ? "filled" : "light"} color="plum">
                {settings.notifyOnYield ? "On" : "Off"}
              </Badge>
            ),
            closeSpotlightOnTrigger: false,
            onClick: () => {
              if (
                !settings.notifyOnYield &&
                typeof Notification !== "undefined" &&
                Notification.permission === "default"
              ) {
                void Notification.requestPermission();
              }
              onToggleSetting("notifyOnYield");
            },
          },
          {
            id: "settings-enter-submits",
            label: "Enter submits message",
            description: settings.enterSubmits
              ? "Enter sends message, Shift+Enter adds newline"
              : "Ctrl+Enter sends message, Enter adds newline",
            keywords: "enter submit send return newline shift keyboard shortcuts",
            leftSection: <IconCornerDownLeft size={16} />,
            rightSection: (
              <Badge size="xs" variant={settings.enterSubmits ? "filled" : "light"} color="plum">
                {settings.enterSubmits ? "On" : "Off"}
              </Badge>
            ),
            closeSpotlightOnTrigger: false,
            onClick: () => onToggleSetting("enterSubmits"),
          },
        ],
      },
    ],
    [
      settings.showThinking,
      settings.showToolCalls,
      settings.notifyOnYield,
      settings.enterSubmits,
      onToggleSetting,
    ],
  );

  /** `/btw`: ask a transient side question. */
  const btwActions = useMemo<PaletteAction[]>(() => {
    const question = term.trim();
    return [
      {
        group: "Side question (/btw)",
        actions: [
          {
            id: "btw-ask",
            label: question ? `Ask: “${question}”` : "Type a side question",
            description: "Answers transiently without adding to conversation history",
            keywords: "btw question side ephemeral",
            leftSection: <IconMessageQuestion size={16} color="var(--mantine-color-cyan-4)" />,
            disabled: question.length === 0,
            onClick: () => {
              spotlight.close();
              onQueryChange("");
              onBtw?.(question);
            },
          },
        ],
      },
    ];
  }, [term, onBtw]);

  /** `/omfg`: synthesize a rule from an agent mistake. */
  const omfgActions = useMemo<PaletteAction[]>(() => {
    const complaint = term.trim();
    return [
      {
        group: "Create rule from mistake (/omfg)",
        actions: [
          {
            id: "omfg-analyze",
            label: complaint ? `Analyze mistake: “${complaint}”` : "Describe what went wrong",
            description: "Synthesizes a TTSR stream rule from conversation history",
            keywords: "omfg rule mistake fix ttsr",
            leftSection: <IconShield size={16} color="var(--mantine-color-orange-4)" />,
            disabled: complaint.length === 0,
            onClick: () => {
              spotlight.close();
              onQueryChange("");
              onOmfg?.(complaint);
            },
          },
        ],
      },
    ];
  }, [term, onOmfg, onQueryChange]);

  /** `/mcp`: manage and configure MCP servers. */
  const mcpServerActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        group: "MCP Servers (/mcp)",
        actions: [
          {
            id: "mcp-manage-action",
            label: "Open MCP Server Manager",
            description: "View configured servers, test connections, and add new ones",
            keywords: "mcp servers tools plugins connect add test",
            leftSection: <IconPlugConnected size={16} color="var(--mantine-color-cyan-4)" />,
            onClick: () => handleOpenDrawer(onOpenMcp),
          },
        ],
      },
    ];
  }, [handleOpenDrawer, onOpenMcp]);
  const costActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Token Economics & Cost",
        actions: [
          {
            id: "cost-render",
            label: "Render Cost Breakdown",
            description: "Visualizes token burn rate, dollar cost, and token proportions",
            keywords: "cost tokens economics breakdown burn",
            leftSection: <IconCoin size={16} color="var(--mantine-color-yellow-4)" />,
            onClick: () => onShowCost?.(),
          },
        ],
      },
    ],
    [onShowCost],
  );
  const usageActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Provider Rate Limits & Quotas",
        actions: [
          {
            id: "usage-render",
            label: "Render Provider Quotas",
            description: "Visualizes provider rate limits, quota windows, and remaining capacity",
            keywords: "usage quota provider rate limits capacity",
            leftSection: <IconCpu size={16} color="var(--mantine-color-plum-4)" />,
            onClick: () => onShowUsage?.(),
          },
        ],
      },
    ],
    [onShowUsage],
  );
  const statsActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Performance & Latency",
        actions: [
          {
            id: "stats-render",
            label: "Render Session Stats",
            description: "Visualizes turn duration, latency trends, and tool call frequency",
            keywords: "stats metrics latency performance dashboard tool calls",
            leftSection: <IconChartBar size={16} color="var(--mantine-color-cyan-4)" />,
            onClick: () => onShowStats?.(),
          },
        ],
      },
    ],
    [onShowStats],
  );
  /** `/context`: context reduction choices. */
  const contextActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Reduce Context Size",
        actions: [
          {
            id: "context-compact",
            label: "/compact",
            description: "Summarize conversation history into a concise checkpoint",
            keywords: "compact summarize reduce context",
            leftSection: <IconArchive size={16} color="var(--mantine-color-plum-4)" />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.compact} `),
          },
          {
            id: "context-shake",
            label: "/shake",
            description: "Drop heavy tool results or images from active context",
            keywords: "shake drop images tool results reduce context",
            leftSection: <IconFilterX size={16} color="var(--mantine-color-orange-4)" />,
            closeSpotlightOnTrigger: false,
            onClick: () => onQueryChange(`${PALETTE_COMMAND.shake} `),
          },
        ],
      },
    ],
    [onQueryChange],
  );
  /** `/tools`: tool inspector and forcing. */
  const toolsActions = useMemo<PaletteAction[]>(() => {
    const list = toolsList ?? [];
    return [
      {
        group: "Tool Inspector",
        actions: [
          {
            id: "tools-open-drawer",
            label: "Open Tool Inspector (/tools)",
            description: `Inspect ${list.length} available tools across built-in, custom, MCP, and xdev`,
            keywords: "tools active available mcp custom xdev inspect",
            leftSection: <IconTools size={16} color="var(--mantine-color-teal-4)" />,
            onClick: () => handleOpenDrawer(onOpenTools),
          },
        ],
      },
      ...(list.length > 0
        ? [
            {
              group: "Available Tools (click to force next turn)",
              actions: list.map(tool => ({
                id: `tool-${tool.name}`,
                label: tool.name,
                description: tool.description,
                keywords: `${tool.name} ${tool.source} ${tool.active ? "active" : ""}`,
                leftSection: <IconBolt size={16} color="var(--mantine-color-cyan-4)" />,
                onClick: () => onForceTool?.(tool.name),
              })),
            },
          ]
        : []),
    ];
  }, [toolsList, handleOpenDrawer, onOpenTools, onForceTool]);

  /** `/force`: force next turn tool. */
  const forceActions = useMemo<PaletteAction[]>(() => {
    const list = toolsList ?? [];
    const chosen = term.trim();
    return [
      {
        group: "Force Tool Choice (/force)",
        actions: [
          ...(chosen
            ? [
                {
                  id: "force-typed-tool",
                  label: `Force: “${chosen}”`,
                  description: "Agent will be forced to use this tool on the next turn",
                  keywords: "force tool choice",
                  leftSection: <IconBolt size={16} color="var(--mantine-color-cyan-4)" />,
                  onClick: () => onForceTool?.(chosen),
                },
              ]
            : []),
          ...list.map(tool => ({
            id: `force-tool-${tool.name}`,
            label: `Force: ${tool.name}`,
            description: tool.description,
            keywords: `${tool.name} ${tool.source} force`,
            leftSection: <IconBolt size={16} color="var(--mantine-color-cyan-4)" />,
            onClick: () => onForceTool?.(tool.name),
          })),
        ],
      },
    ];
  }, [toolsList, term, onForceTool]);

  /** `/rules`: stream rules. */
  const rulesActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        group: "Stream Rules (/rules)",
        actions: [
          {
            id: "rules-open-drawer",
            label: "Open Stream Rules Manager",
            description: "View, manage, and delete Time-Traveling Stream Rules (TTSR)",
            keywords: "rules ttsr stream regex conditions delete",
            onClick: () => handleOpenDrawer(onOpenRules),
          },
        ],
      },
    ];
  }, [handleOpenDrawer, onOpenRules]);
  /** `/jobs`: background jobs. */
  const jobsActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        group: "Background Jobs (/jobs)",
        actions: [
          {
            id: "jobs-open-drawer",
            label: "Open Background Jobs Drawer",
            description: "View active and recent async background jobs",
            keywords: "jobs background async workers subagents cancel",
            onClick: () => handleOpenDrawer(onOpenJobs),
          },
        ],
      },
    ];
  }, [handleOpenDrawer, onOpenJobs]);

  /** `/ps`: supervised processes. */
  const processActions = useMemo<PaletteAction[]>(() => {
    return [
      {
        group: "Supervised Processes (/ps)",
        actions: [
          {
            id: "ps-open-drawer",
            label: "Open Process Manager",
            description: "View supervised daemons, send signals, and manage services",
            keywords: "ps processes daemons services supervisor signal restart stop",
            onClick: () => handleOpenDrawer(onOpenProcesses),
          },
        ],
      },
    ];
  }, [handleOpenDrawer, onOpenProcesses]);

  /** `/rename`: the term is the new title, so there is one action to confirm it. */
  const renameActions = useMemo<PaletteAction[]>(() => {
    const title = term.trim();
    return [
      {
        group: "Rename session",
        actions: [
          {
            id: "rename-confirm",
            label: title ? `Rename to “${title}”` : "Type a new title",
            description: state?.title ? `Now “${state.title}”` : "This session has no title yet",
            keywords: "rename title",
            leftSection: <IconPencil size={16} />,
            disabled: title.length === 0,
            onClick: () => onRename(title),
          },
        ],
      },
    ];
  }, [term, state?.title, onRename]);

  /**
   * The argument-free commands each get a one-action list too, so typing the
   * command and pressing Enter runs it instead of finding nothing.
   */
  const retryActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Retry",
        actions: [
          {
            id: "retry-confirm",
            label: "Retry the last turn",
            description: RETRY_DESCRIPTION,
            keywords: "retry again failed",
            leftSection: <IconRefresh size={16} />,
            onClick: onRetry,
          },
        ],
      },
    ],
    [onRetry],
  );

  const abortActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Abort",
        actions: [
          {
            id: "abort-confirm",
            label: "Interrupt the current turn",
            description:
              state?.streaming === true ? "The agent stops where it is" : "Nothing is running to interrupt",
            keywords: "abort interrupt cancel",
            leftSection: <IconPlayerStopFilled size={16} />,
            onClick: onAbort,
          },
        ],
      },
    ],
    [state?.streaming, onAbort],
  );

  const planActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Plan mode",
        actions: [
          {
            id: "plan-toggle",
            label: planEnabled ? "Disable plan mode" : "Enable plan mode",
            description: planEnabled
              ? "Stop planning and let the agent modify code again"
              : "The agent researches and drafts a plan before modifying code",
            keywords: "plan mode planning",
            leftSection: <IconRoute size={16} />,
            onClick: () => onTogglePlanMode(!planEnabled),
          },
        ],
      },
    ],
    [planEnabled, onTogglePlanMode],
  );

  const newActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "New session",
        actions: [
          {
            id: "new-here",
            label: "New session here",
            description: newDescription,
            keywords: "new start session",
            leftSection: <IconPlus size={16} />,
            disabled: !activeProject,
            onClick: () => {
              if (activeProject) onNewSession(activeProject);
            },
          },
        ],
      },
    ],
    [activeProject, newDescription, onNewSession],
  );

  const forkActions = useMemo<PaletteAction[]>(
    () => [
      {
        group: "Fork session",
        actions: [
          {
            id: "fork-confirm",
            label: "Fork this session",
            description: FORK_DESCRIPTION,
            keywords: "fork copy duplicate",
            leftSection: <IconGitFork size={16} />,
            onClick: onFork,
          },
        ],
      },
    ],
    [onFork],
  );

  /**
   * `/branch`: the user messages this conversation can restart from, newest
   * first — the server returns them oldest-first, and the message a user wants
   * to rewind to is almost always a recent one. The numbering stays
   * chronological so it matches the transcript.
   */
  const branchActions = useMemo<PaletteAction[]>(() => {
    if (branchPoints.length === 0) return [];
    return [
      {
        group: "Branch from a message",
        actions: branchPoints
          .map((point, index) => ({
            id: `branch-${point.entryId}`,
            label: point.text,
            description: `Message ${index + 1} of ${branchPoints.length}`,
            keywords: [point.entryId],
            leftSection: <IconGitBranch size={16} />,
            onClick: () => onBranch(point),
          }))
          .reverse(),
      },
    ];
  }, [branchPoints, onBranch]);

  /**
   * `/stop`: only live sessions, because stopping anything else is a no-op —
   * the server has nothing in memory to release.
   */
  const stopActions = useMemo<PaletteAction[]>(() => {
    if (liveSessions.length === 0) return [];
    return [
      {
        group: `Live sessions (${liveSessions.length})`,
        actions: liveSessions.map(({ workspace, session }) => ({
          id: `stop-${session.path}`,
          label: session.title || session.firstMessage || "Untitled session",
          description: `${workspace.cwd} · ${session.messageCount} msg · ${relative(session.modified)}`,
          keywords: [workspace.cwd, workspace.name, session.id, "stop"],
          leftSection: <IconPlayerStopFilled size={16} color="var(--mantine-color-orange-4)" />,
          onClick: () => onStopSession(session),
        })),
      },
    ];
  }, [liveSessions, onStopSession]);

  /** `/delete`: every session on disk, live or not. Deleting confirms first. */
  const deleteActions = useMemo<PaletteAction[]>(
    () =>
      workspaces
        .filter(workspace => workspace.sessions.length > 0)
        .map(workspace => ({
          group: `${workspace.name} — ${workspace.cwd}`,
          actions: workspace.sessions.map(session => ({
            id: `delete-${session.path}`,
            label: session.title || session.firstMessage || "Untitled session",
            description: `${session.live ? "live · " : ""}${session.status} · ${session.messageCount} msg · ${relative(session.modified)}`,
            keywords: [workspace.cwd, workspace.name, session.id, "delete"],
            leftSection: <IconTrash size={16} color="var(--mantine-color-red-4)" />,
            onClick: () => onDeleteSession(session),
          })),
        })),
    [workspaces, onDeleteSession],
  );

  const actionsByCommand: Record<PaletteCommand, PaletteAction[]> = {
    "/switch": modelActions,
    "/cd": projectActions,
    "/resume": sessionActions,
    "/compact": compactActions,
    "/shake": shakeActions,
    "/think": thinkActions,
    "/btw": btwActions,
    "/omfg": omfgActions,
    "/mcp": mcpServerActions,
    "/cost": costActions,
    "/stats": statsActions,
    "/context": contextActions,
    "/tools": toolsActions,
    "/force": forceActions,
    "/rules": rulesActions,
    "/usage": usageActions,
    "/rename": renameActions,
    "/retry": retryActions,
    "/abort": abortActions,
    "/plan": planActions,
    "/new": newActions,
    "/fork": forkActions,
    "/branch": branchActions,
    "/stop": stopActions,
    "/delete": deleteActions,
    "@": fileActions,
    "/omega-settings": settingsActions,
    "/jobs": jobsActions,
    "/ps": processActions,
    "/wt": [],
  };
  // The command prefix scopes the list rather than searching it, so it is
  // stripped before matching; otherwise every action would have to contain "/cd".
  const filter = useCallback((raw: string, items: PaletteAction[]): PaletteAction[] => {
    const parsed = parseQuery(raw);
    // `/compact` and `/rename` read their term as content, not as a filter:
    // typing a focus phrase or a new title must not empty their list.
    if (parsed.command && COMMAND_SPEC[parsed.command].termIsInput) return items;
    const tokens = parsed.term
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(token => token.length > 0);
    if (tokens.length === 0) return items;
    if (parsed.command === "@") {
      const term = parsed.term.trim();
      if (!term) return items;

      const scoredActions: Array<{ action: SpotlightActionData; score: number }> = [];

      for (const item of items) {
        if (!isActionsGroup(item)) {
          const s = scoreFileMatch(item.label as string, term);
          if (s > 0) scoredActions.push({ action: item, score: s });
        } else {
          for (const action of item.actions) {
            const s = scoreFileMatch(action.label as string, term);
            if (s > 0) scoredActions.push({ action, score: s });
          }
        }
      }

      // Sort by score descending (highest score / most relevant matches first!)
      scoredActions.sort(
        (a, b) => b.score - a.score || (a.action.label ?? "").localeCompare(b.action.label ?? ""),
      );

      // Take top matches (up to 60)
      const topActions = scoredActions.slice(0, 60).map(sa => sa.action);
      if (topActions.length === 0) return [];

      return [
        {
          group: `Matching files (${scoredActions.length})`,
          actions: topActions,
        },
      ];
    }
    return items
      .map(item => {
        if (!isActionsGroup(item)) return matches(item, tokens) ? item : undefined;
        const kept = item.actions.filter(action => matches(action, tokens));
        return kept.length > 0 ? { ...item, actions: kept } : undefined;
      })
      .filter((item): item is PaletteAction => item !== undefined);
  }, []);

  /**
   * Backspace on an empty input closes the palette, but a held-down backspace
   * that just finished deleting text must not slam the door shut.
   */
  const lastNonEmptyAt = useRef(0);
  useEffect(() => {
    if (query !== "") {
      lastNonEmptyAt.current = Date.now();
    }
  }, [query]);

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Backspace") {
        if (event.repeat) return;
        const target = event.target as HTMLInputElement | null;
        const val = target?.value ?? query;
        if (val === "" && Date.now() - lastNonEmptyAt.current > 120) {
          event.preventDefault();
          spotlight.close();
          onQueryChange("");
        }
      }
    },
    [query, onQueryChange],
  );

  const nothingFound =
    command === PALETTE_COMMAND.file && (!activeProject || files.length === 0)
      ? "No files found in this workspace"
      : command === PALETTE_COMMAND.session && !activeProject
        ? "Pick a workspace with /cd first"
        : command === PALETTE_COMMAND.stop
          ? "No sessions are live"
          : command === PALETTE_COMMAND.think && !sessionKey
            ? "Open a session first"
            : command === PALETTE_COMMAND.branch
              ? "No user messages to branch from"
              : "Nothing matches your search";

  return (
    <Spotlight
      actions={command ? actionsByCommand[command] : commandActions}
      query={query}
      onQueryChange={onQueryChange}
      filter={filter}
      nothingFound={nothingFound}
      onSpotlightOpen={onRefreshWorkspaces}
      onSpotlightClose={() => onQueryChange("")}
      clearQueryOnClose
      searchProps={{
        placeholder: command ? COMMAND_SPEC[command].placeholder : "Type / for commands, @ for files…",
        leftSection: <IconSearch size={18} />,
        onKeyDown: handleSearchKeyDown,
      }}
      scrollable
      maxHeight={420}
      shortcut={["mod + shift + K", "meta + shift + K"]}
    />
  );
}
