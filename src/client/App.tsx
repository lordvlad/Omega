/**
 * The app shell.
 *
 * Two surfaces — chat and planning — over one live session. On a wide screen
 * the session tree is a permanent sidebar and planning is a right-hand panel;
 * on a phone both become overlays, because 390px has room for exactly one
 * thing at a time.
 *
 * Every server call goes through the generated react-query hooks, so the query
 * keys, request shapes and response types all come from the OpenAPI document
 * that `src/shared/service.ts` produces.
 */
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Indicator,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconChevronDown,
  IconFolder,
  IconHighlight,
  IconHistory,
  IconLayout2,
  IconListCheck,
  IconMessage,
  IconNote,
  IconPencil,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type A2uiActionEvent, isAgentSurface } from "../shared/a2ui.ts";
import { ApiError } from "./api/api.ts";
import type {
  AddMcpServerRequest,
  Attachment,
  CancelJobRequest,
  DeleteRuleRequest,
  ForceToolRequest,
  LiveState,
  MutateTodosRequest,
  OmfgRuleCandidate,
  PlanAction,
  Problem,
  ProcessActionRequest,
  QueuedMessage,
  RemoveMcpServerRequest,
  SessionSummary,
  ShakeMode,
  SignalProcessRequest,
  TestMcpServerRequest,
  TestMcpServerResult,
  ThinkingLevel,
  ToggleMcpServerRequest,
} from "./api/model.ts";
import {
  useAbort,
  useAddMcpServer,
  useAnalyzeOmfg,
  useAskBtw,
  useBranchSession,
  useCancelJob,
  useCompactSession,
  useDeleteRule,
  useDeleteSession,
  useDismissSurface,
  useDropQueued,
  useEditPlan,
  useEditQueued,
  useForceTool,
  useForkSession,
  useMutateTodos,
  useOpenSession,
  usePrompt,
  useRemoveMcpServer,
  useRenameSession,
  useRenderMarkdown,
  useResolvePlan,
  useRestartProcess,
  useRetryTurn,
  useSaveOmfgRule,
  useSelectModel,
  useSetPlanMode,
  useSetThinkingLevel,
  useShakeSession,
  useSignalProcess,
  useStopProcess,
  useStopSession,
  useTestMcpServer,
  useToggleMcpServer,
} from "./api/mutations.ts";
import {
  getGetPlanQueryOptions,
  getGetStateQueryOptions,
  getGetTranscriptQueryOptions,
  getListQueueQueryOptions,
  useGetPlan,
  useGetState,
  useGetTranscript,
  useListBranchPoints,
  useListCommands,
  useListJobs,
  useListMcpServers,
  useListProcesses,
  useListRules,
  useListTools,
  useListQueue,
  useListModels,
  useListWorkspaces,
  useGetGitStatus,
  useListFiles,
} from "./api/queries.ts";
import { A2UIRenderer } from "./components/A2UIRenderer.tsx";
import { AnnotationsPanel } from "./components/AnnotationsPanel.tsx";
import { BtwPanel, type BtwTurn } from "./components/BtwPanel.tsx";
import {
  CommandPalette,
  type CompactMode,
  openPalette,
  openPaletteCommands,
  openPaletteFiles,
  PALETTE_COMMAND,
} from "./components/CommandPalette.tsx";
import { Composer } from "./components/Composer.tsx";
import { FileTreePanel } from "./components/FileTreePanel.tsx";
import { FileViewer } from "./components/FileViewer.tsx";
import { JobsPanel } from "./components/JobsPanel.tsx";
import { McpPanel } from "./components/McpPanel.tsx";
import { OmfgPanel } from "./components/OmfgPanel.tsx";
import { Planning } from "./components/Planning.tsx";
import { ProcessPanel } from "./components/ProcessPanel.tsx";
import { QueuePanel, queueSummary } from "./components/QueuePanel.tsx";
import { ResizableDrawer } from "./components/ResizableDrawer.tsx";
import { RulesPanel } from "./components/RulesPanel.tsx";
import { SubagentPanel } from "./components/SubagentPanel.tsx";
import { SurfaceAnnotationLayer } from "./components/SurfaceAnnotationLayer.tsx";
import { TodoPanel } from "./components/TodoPanel.tsx";
import { ToolsPanel } from "./components/ToolsPanel.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { formatAnnotations, useAnnotations } from "./lib/annotations.ts";
import { showYieldNotification } from "./lib/notifications.ts";
import { useOnline } from "./lib/online.ts";
import { newSendId } from "./lib/outbox.ts";
import { useProjectSettings } from "./lib/settings.ts";
import { type YieldEvent, useLiveTurn } from "./lib/stream.ts";
import { forgetTranscript, usePersistedTranscript } from "./lib/transcript-cache.ts";
import { useVisualViewport } from "./lib/viewport.ts";

/**
 * Header hyperlinks. Every piece of session identity in the header — session
 * title, model, workspace — is a link into the command palette, so the thing
 * shown and the way to change it are the same control.
 */
const HEADER_LINK = {
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  maxWidth: "100%",
  // Without this the intrinsic width of the label wins over the flex
  // container and `truncate` never engages, so a long title pushes the
  // header's right-hand controls off their own edge.
  minWidth: 0,
} as const;
const HEADER_UNDERLINE = { textDecoration: "underline", textUnderlineOffset: "3px" } as const;
/** Separators are punctuation: they never absorb the shrinking. */
const HEADER_SEPARATOR = { flexShrink: 0 } as const;

/**
 * Messages fetched and rendered at once.
 *
 * The transcript is plain DOM, so this is the cap that keeps a very long
 * conversation from mounting all of itself: a thousand messages render and
 * scroll without virtualisation, and older history is one button away.
 */
const TRANSCRIPT_PAGE = 1000;

/**
 * One id for the connection toast, so the warning and the all-clear are the
 * same notification rather than two.
 */
const CONNECTION_TOAST = "omega-connection";
/** How long a stream may be down before it is worth interrupting the user. */
const CONNECTION_GRACE_MS = 3_000;

export function App() {
  // `project` (workspace cwd) and `session` (omp session id) are path params,
  // so a conversation is linkable and the browser's own back/forward moves
  // between sessions. `strict: false` reads whichever of the three routes
  // matched without the shell having to know which one.
  const params = useParams({ strict: false });
  const sessionKey = params.session;
  const project = params.project;
  const navigate = useNavigate();

  const [planOpen, { open: openPlan, close: closePlan }] = useDisclosure(false);
  /** The BTW transient side-question drawer. */
  const [btwDrawerOpen, { open: openBtw, close: closeBtw }] = useDisclosure(false);
  const [btwTurns, setBtwTurns] = useState<BtwTurn[]>([]);

  /** The OMFG rule synthesizer drawer. */
  const [omfgDrawerOpen, { open: openOmfg, close: closeOmfg }] = useDisclosure(false);
  const [omfgComplaint, setOmfgComplaint] = useState("");
  const [omfgCandidate, setOmfgCandidate] = useState<OmfgRuleCandidate | undefined>(undefined);
  /** Controlled palette query; a header hyperlink prefills the command. */
  const [paletteQuery, setPaletteQuery] = useState("");
  const [todoOpen, { toggle: toggleTodo, close: closeTodo }] = useDisclosure(false);
  const [treeOpen, { toggle: toggleTree, close: closeTree }] = useDisclosure(false);
  const [viewingFile, setViewingFile] = useState<string | null>(() => {
    const match = /^#file=(.+)$/.exec(window.location.hash);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1] ?? "");
    } catch {
      return match[1] ?? null;
    }
  });

  // A link inside a rendered markdown file writes `#file=<path>` directly
  // (see `openInternalFile` in lib/markdown.tsx) so that clicking a repo
  // link works the same as clicking a row in the file tree, and so the
  // browser's back/forward buttons step through visited files.
  useEffect(() => {
    const syncFromHash = (): void => {
      const match = /^#file=(.+)$/.exec(window.location.hash);
      if (!match) {
        setViewingFile(null);
        return;
      }
      try {
        setViewingFile(decodeURIComponent(match[1] ?? ""));
      } catch {
        setViewingFile(match[1] ?? null);
      }
    };
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  // The reverse direction: opening a file from the tree, an annotation, or
  // a `@` reference updates `viewingFile` state directly, so the hash is
  // kept in sync here rather than at every call site.
  useEffect(() => {
    const desired = viewingFile ? `#file=${encodeURIComponent(viewingFile)}` : "";
    const current = window.location.hash;
    if (current === desired) return;
    if (desired) {
      window.history.replaceState(null, "", desired);
    } else if (current.startsWith("#file=")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [viewingFile]);
  const [mobileComposerOverFile, setMobileComposerOverFile] = useState(false);

  useEffect(() => {
    if (!viewingFile) {
      setMobileComposerOverFile(false);
    }
  }, [viewingFile]);
  /** The queue panel, opened from the composer's queued-message hint. */
  /** The tools inspector and forced-choice drawer. */
  const [toolsDrawerOpen, { open: openTools, close: closeTools }] = useDisclosure(false);
  /** The stream rules manager drawer. */
  const [rulesDrawerOpen, { open: openRules, close: closeRules }] = useDisclosure(false);
  const [queueOpen, { open: openQueue, close: closeQueue }] = useDisclosure(false);
  /** The A2UI surface drawer, opened automatically when a surface arrives. */
  const [
    surfaceDrawerOpen,
    { open: openSurfaceDrawer, close: closeSurfaceDrawer, toggle: toggleSurfaceDrawer },
  ] = useDisclosure(false);
  /** The sub-agents panel, opened from the working badge in transcript. */
  const [subagentDrawerOpen, { open: openSubagents, close: closeSubagents }] = useDisclosure(false);
  /** The MCP server management drawer. */
  const [mcpDrawerOpen, { open: openMcp, close: closeMcp }] = useDisclosure(false);
  /** The background jobs drawer. */
  const [jobsDrawerOpen, { open: openJobs, close: closeJobs }] = useDisclosure(false);
  /** The supervised processes drawer. */
  const [processDrawerOpen, { open: openProcesses, close: closeProcesses }] = useDisclosure(false);
  /** The annotations drawer, opened from the composer's annotation count. */
  const [annotationsOpen, { open: openAnnotations, close: closeAnnotations }] = useDisclosure(false);
  /**
   * Which surface has a tool armed, if any.
   *
   * One at a time: the pen and the sticky note both capture the pointer, and
   * two armed surfaces would leave the user guessing which one is listening.
   */
  const [penSurface, setPenSurface] = useState<string | null>(null);
  const [noteSurface, setNoteSurface] = useState<string | null>(null);
  /** A sticky note just dropped, whose editor should open on its own. */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  /** Tracks pending session switch so a clean loader shows the instant a change is triggered. */
  const [switchingSession, setSwitchingSession] = useState<string | null>(null);
  /** Sent messages not yet echoed back by the server transcript. */
  const [pendingUser, setPendingUser] = useState<string[]>([]);
  /** Message text a branch handed back, for the composer to pick up. */
  const [draft, setDraft] = useState<{ text: string } | undefined>(undefined);
  /**
   * A file path picked for an `@` mention. Keyed with a counter so picking
   * the same path twice still reaches the composer as a fresh insert.
   */
  const [insertedFile, setInsertedFile] = useState<{ path: string; id: number } | undefined>(undefined);

  const [settings, toggleSetting] = useProjectSettings(project);
  const annotations = useAnnotations(sessionKey);

  // Publishes the visible viewport height, so the on-screen keyboard shortens
  // the chat column instead of covering the composer.
  useVisualViewport();

  // Up to 5 most recently used models, listed first under `/switch`.
  const [recentModels, setRecentModels] = useLocalStorage<string[]>({
    key: "omega.recent-models",
    defaultValue: [],
  });

  // One breakpoint drives every layout decision, so the surfaces cannot
  // disagree about whether this is a phone.
  const narrow = useMediaQuery("(max-width: 62em)") ?? false;
  const queryClient = useQueryClient();
  /** Whether the device has a network, as opposed to whether omega answers. */
  const online = useOnline();

  /**
   * Point the URL at a workspace and/or session.
   *
   * Each combination is its own route rather than an optional segment, so a
   * URL never carries an empty `/s/` tail.
   */
  const navigateTo = useCallback(
    (next: { project?: string; session?: string }, options?: { replace?: boolean }) => {
      const replace = options?.replace === true;
      if (next.project && next.session) {
        void navigate({
          to: "/w/$project/s/$session",
          params: { project: next.project, session: next.session },
          replace,
        });
      } else if (next.project) {
        void navigate({ to: "/w/$project", params: { project: next.project }, replace });
      } else if (next.session) {
        void navigate({ to: "/s/$session", params: { session: next.session }, replace });
      } else {
        void navigate({ to: "/", replace });
      }
    },
    [navigate],
  );

  const workspaces = useListWorkspaces(undefined, { staleTime: 15_000 });
  const models = useListModels(undefined, { staleTime: 5 * 60_000 });

  const state = useGetState({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  const gitStatus = useGetGitStatus(
    { query: { cwd: state.data?.cwd } },
    { enabled: Boolean(sessionKey && state.data?.cwd) },
  );
  const files = useListFiles(
    { query: { cwd: state.data?.cwd } },
    { enabled: Boolean(sessionKey && state.data?.cwd) },
  );
  /**
   * The transcript window.
   *
   * Messages render as plain DOM rather than through a virtualiser, so the
   * number on screen is bounded here instead: one page is the newest 1000
   * messages, and "load older" grows the window by another page. Thinking and
   * tool parts the display settings hide are dropped by the server, so a
   * conversation nobody wants to see the tool output of does not send it.
   */
  const [transcriptLimit, setTranscriptLimit] = useState(TRANSCRIPT_PAGE);
  useEffect(() => {
    setTranscriptLimit(TRANSCRIPT_PAGE);
  }, [sessionKey]);
  const transcriptQuery = useMemo(
    () => ({
      limit: transcriptLimit,
      thinking: settings.showThinking,
      toolCalls: settings.showToolCalls,
    }),
    [transcriptLimit, settings.showThinking, settings.showToolCalls],
  );
  const transcriptOptions = useMemo(
    () => ({ path: { key: sessionKey ?? "" }, query: transcriptQuery }),
    [sessionKey, transcriptQuery],
  );
  const transcript = useGetTranscript(transcriptOptions, {
    enabled: Boolean(sessionKey),
    // Widening the window is a new cache key, and an empty transcript between
    // the two is both a flash of nothing and a scroll position thrown away.
    // The previous window stands in until the wider one lands.
    placeholderData: previous => previous,
  });
  // Show the conversation that was on screen last time while the fetch runs,
  // and while a released session is being re-opened.
  usePersistedTranscript(sessionKey, transcript.data, transcriptQuery);
  const plan = useGetPlan({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  const branchPoints = useListBranchPoints(
    { path: { key: sessionKey ?? "" } },
    { enabled: Boolean(sessionKey), staleTime: 5_000 },
  );
  // MCP prompts change only when a server reconnects, which the session
  // outlives; a long stale time keeps the palette from refetching on every
  // open.
  const mcpCommands = useListCommands(
    { path: { key: sessionKey ?? "" } },
    { enabled: Boolean(sessionKey), staleTime: 60_000 },
  );
  // The stream tells us when snapshot state went stale; refetching beats
  // mirroring omp's whole state machine in the client.
  const refresh = useCallback(() => {
    if (!sessionKey) return;
    const path = { path: { key: sessionKey } };
    void queryClient.invalidateQueries({ queryKey: getGetStateQueryOptions(path).queryKey });
    // The transcript key carries its window, so invalidating one window would
    // leave the others stale; the route prefix covers every window this
    // session has fetched.
    void queryClient.invalidateQueries({
      queryKey: [getGetTranscriptQueryOptions(transcriptOptions).queryKey[0]],
    });
    void queryClient.invalidateQueries({ queryKey: getGetPlanQueryOptions(path).queryKey });
  }, [queryClient, sessionKey, transcriptOptions]);

  const openSession = useOpenSession();
  const prompt = usePrompt();
  const abort = useAbort();
  const selectModel = useSelectModel();
  const setPlanMode = useSetPlanMode();
  const resolvePlan = useResolvePlan();
  const editPlan = useEditPlan();
  const stopSession = useStopSession();
  const deleteSession = useDeleteSession();
  const compactSession = useCompactSession();
  const shakeSession = useShakeSession();
  const setThinking = useSetThinkingLevel();
  const renameSession = useRenameSession();
  const retryTurn = useRetryTurn();
  const forkSession = useForkSession();
  const branchSession = useBranchSession();
  const editQueued = useEditQueued();
  const dropQueued = useDropQueued();
  const askBtw = useAskBtw();
  const analyzeOmfg = useAnalyzeOmfg();
  const saveOmfg = useSaveOmfgRule();
  const mcpServers = useListMcpServers({ query: { cwd: project } });
  const addMcp = useAddMcpServer();
  const removeMcp = useRemoveMcpServer();
  const testMcp = useTestMcpServer();
  const toggleMcp = useToggleMcpServer();
  const mutateTodos = useMutateTodos();
  const dismissSurface = useDismissSurface();
  const toolsQuery = useListTools({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  const rulesQuery = useListRules({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  const forceTool = useForceTool();
  const deleteRule = useDeleteRule();

  const jobsQuery = useListJobs({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  const processesQuery = useListProcesses({ query: { cwd: project } });
  const cancelJob = useCancelJob();
  const signalProc = useSignalProcess();
  const stopProc = useStopProcess();
  const restartProc = useRestartProcess();

  // Clear switching indicator once state and transcript match the active sessionKey
  useEffect(() => {
    if (
      sessionKey &&
      state.data?.key === sessionKey &&
      (transcript.data?.key === sessionKey || Boolean(transcript.data?.messages))
    ) {
      setSwitchingSession(null);
    }
  }, [sessionKey, state.data?.key, transcript.data?.key, transcript.data?.messages]);

  const isSessionLoading = Boolean(
    switchingSession ||
    openSession.isPending ||
    forkSession.isPending ||
    branchSession.isPending ||
    (sessionKey &&
      ((state.data && state.data.key !== sessionKey) ||
        (transcript.data && transcript.data.key !== sessionKey) ||
        (state.isPending && !state.data))),
  );
  // A non-2xx response arrives as `ApiError`, whose `message` is only
  // `HTTP 409 for <url>`; the server's own explanation is the `Problem` body,
  // and every session command refuses with one worth reading.
  const fail = (error: unknown): void => {
    const problem = error instanceof ApiError ? (error.body as Problem | undefined) : undefined;
    notifications.show({
      color: "red",
      title: "Request failed",
      message: problem?.detail ?? (error instanceof Error ? error.message : String(error)),
    });
  };

  // Keep recent models updated when active model changes
  useEffect(() => {
    if (!state.data?.model) return;
    const current = state.data.model;
    setRecentModels(prev => [current, ...prev.filter(m => m !== current)].slice(0, 5));
  }, [state.data?.model, setRecentModels]);

  const handleSelectModel = useCallback(
    (ref: string) => {
      if (!sessionKey) return;
      setRecentModels(prev => [ref, ...prev.filter(m => m !== ref)].slice(0, 5));
      selectModel.mutate({ path: { key: sessionKey }, body: { ref } }, { onSuccess: refresh, onError: fail });
    },
    [sessionKey, selectModel, refresh, setRecentModels],
  );

  const handleYield = useCallback(
    (event: YieldEvent) => {
      if (!settings.notifyOnYield) return;
      // Dispatch native browser notification if window is hidden or blurred
      if (document.visibilityState === "hidden" || !document.hasFocus()) {
        const title = state.data?.title || "omega";
        let body: string;
        if (event.type === "plan") {
          body = "Plan ready for review · The agent is waiting on your decision.";
        } else if (event.type === "error") {
          body = `Turn failed: ${event.error ?? "Unknown error"}`;
        } else {
          body = event.summary
            ? event.summary.length > 150
              ? `${event.summary.slice(0, 150)}…`
              : event.summary
            : "Agent finished turn and is ready for your input.";
        }

        void showYieldNotification({
          title,
          body,
          tag: `omega-yield-${event.sessionKey}`,
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          onClick: () => {
            window.focus();
            if (event.type === "plan") openPlan();
          },
        });
      }
    },
    [settings.notifyOnYield, state.data?.title, openPlan],
  );

  const live = useLiveTurn(sessionKey, refresh, handleYield);
  /**
   * What the pull-up gesture asks for.
   *
   * A full page reload, matching native browser pull-to-refresh: re-executes
   * the page lifecycle, clears transient DOM state, reconnects the WebSocket,
   * and refetches all session data fresh.
   */
  const handleReload = useCallback((): void => {
    setTimeout(() => {
      window.location.reload();
    }, 50);
  }, []);
  const knownSurfaceRevisions = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (live.surfaces.length === 0) {
      knownSurfaceRevisions.current.clear();
      return;
    }
    let hasUpdate = false;
    for (const s of live.surfaces) {
      const prevRevision = knownSurfaceRevisions.current.get(s.surfaceId);
      if (prevRevision === undefined || s.revision > prevRevision) {
        knownSurfaceRevisions.current.set(s.surfaceId, s.revision);
        hasUpdate = true;
      }
    }
    if (hasUpdate) {
      openSurfaceDrawer();
    }
  }, [live.surfaces, openSurfaceDrawer]);

  /**
   * The queue is polled, not cached.
   *
   * It only exists while a turn is in flight, the agent drains it as it goes,
   * and a second browser (or omp's own TUI) can add to it — so `queued` on the
   * session snapshot goes stale the moment anything but this tab touches it.
   * The list is the count as well as the contents: it counts only the user
   * prompts the panel can actually edit, where the snapshot's `queued` also
   * counts agent-authored entries nobody can act on.
   */
  const streaming = live.running || state.data?.streaming === true;
  const queueLive = Boolean(sessionKey) && (queueOpen || streaming);
  const queue = useListQueue(
    { path: { key: sessionKey ?? "" } },
    { enabled: queueLive, refetchInterval: queueLive ? 2_000 : false },
  );
  const queued = queue.data?.length ?? 0;

  // A plan arriving for review is the one event worth interrupting for.
  useEffect(() => {
    if (!live.planAwaiting) return;
    openPlan();
    notifications.show({
      color: "cyan",
      title: "Plan ready for review",
      message: "The agent submitted a plan and is waiting on your decision.",
    });
  }, [live.planAwaiting]);

  /**
   * The plan shows itself.
   *
   * There is no plan button any more: a panel with nothing in it does not earn
   * a control, and a plan the agent has just written is worth reading now. So
   * the drawer opens the first time a plan has text, and again whenever that
   * text changes — a revision is news. A plan already shown never reopens
   * itself, so closing it stays closed, and a session whose plan is empty
   * cannot leave a blank drawer on screen.
   */
  const shownPlan = useRef<string | undefined>(undefined);
  useEffect(() => {
    const content = plan.data?.content?.trim() ?? "";
    if (!content) {
      shownPlan.current = undefined;
      closePlan();
      return;
    }
    if (shownPlan.current === content) return;
    shownPlan.current = content;
    openPlan();
  }, [plan.data?.content]);

  // A different conversation's plan is news again.
  useEffect(() => {
    shownPlan.current = undefined;
  }, [sessionKey]);

  /**
   * The header no longer carries a connection badge, so a dropped stream has
   * to announce itself.
   *
   * A brief outage is routine — the socket is remade on every wake, tab
   * switch and navigation — so the warning waits out a grace period. The
   * timer is armed once for a whole outage rather than restarted on each
   * `closed → connecting` retry, or a stream that flaps every second would
   * stay silent forever. One notification id throughout, so the warning
   * becomes the all-clear instead of stacking a second toast on it.
   */
  const warned = useRef(false);
  const graceTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const clearWarning = (): void => {
      if (graceTimer.current !== undefined) {
        window.clearTimeout(graceTimer.current);
        graceTimer.current = undefined;
      }
    };

    if (!sessionKey) {
      clearWarning();
      if (warned.current) {
        warned.current = false;
        notifications.hide(CONNECTION_TOAST);
      }
      return;
    }

    if (live.status === "open") {
      clearWarning();
      if (!warned.current) return;
      warned.current = false;
      notifications.update({
        id: CONNECTION_TOAST,
        position: "top-center",
        color: "cyan",
        loading: false,
        withCloseButton: true,
        autoClose: 2_500,
        title: "Reconnected",
        message: "Live updates are flowing again.",
      });
      return;
    }

    // The reason the socket is down can change while the toast is up — the
    // network drops out from under an already-reported reconnect, or comes
    // back before the server does. Re-state it rather than leaving the first
    // guess on screen: "messages still send" is false once the radio is off.
    const body = (): Parameters<typeof notifications.show>[0] => {
      const offline = !online;
      return {
        id: CONNECTION_TOAST,
        position: "top-center",
        color: offline ? "orange" : "yellow",
        loading: !offline,
        withCloseButton: false,
        autoClose: false,
        title: offline ? "Offline" : "Connection lost",
        message: offline
          ? "This device has no network. Conversations you have opened before are still readable, and anything you send is queued and delivered when the network returns — closing the tab is safe."
          : "Reconnecting. Messages still send, but replies will not stream until it is back.",
      };
    };

    if (warned.current) {
      notifications.update(body());
      return;
    }
    if (graceTimer.current !== undefined) return;
    graceTimer.current = window.setTimeout(() => {
      graceTimer.current = undefined;
      warned.current = true;
      notifications.show(body());
    }, CONNECTION_GRACE_MS);
  }, [sessionKey, live.status, online]);

  // Retire each echo as soon as the fetched transcript contains it, matching on
  // text rather than position so a steer landing out of order still clears and
  // no message is ever rendered twice.
  useEffect(() => {
    const persisted = transcript.data?.messages;
    if (!persisted) return;
    const sent = persisted
      .filter(message => message.role === "user")
      .map(message => message.parts.map(part => part.text).join("\n"));
    if (sent.length === 0) return;
    // Prefix, not equality: a message sent with attachments comes back with
    // the inlined files or an `[image]` marker appended, so the persisted copy
    // is longer than the echo. Requiring an exact match strands the echo and
    // the message renders twice, for good.
    const delivered = (echo: string): boolean => sent.some(text => text.startsWith(echo));
    setPendingUser(current => (current.some(delivered) ? current.filter(text => !delivered(text)) : current));
  }, [transcript.data]);

  // Echoes belong to the conversation they were typed into.
  useEffect(() => {
    setPendingUser([]);
  }, [sessionKey]);

  /**
   * Re-open a session the server no longer holds.
   *
   * A URL outlives the process that served it: a shared link, a reload, or a
   * server restart all arrive with a session id the registry has never
   * opened. So does simply leaving the tab alone — the idle sweep releases a
   * session after `OMEGA_IDLE_MINUTES`, and `/ws/:key` then answers 404 for
   * a key that will never come back on its own.
   *
   * This used to latch on the session id and never clear, so it re-opened at
   * most once per page load. The second release of the same session — a tab
   * left open across two idle periods, which is the normal way to use this —
   * hit the latch and did nothing, and the socket retried a 404 forever
   * behind a spinner that never resolved. Reloading the page was the only
   * way out, because that is what cleared the ref.
   *
   * So the guard is now per-attempt rather than permanent: one re-open in
   * flight at a time, and a short cooldown after each so a session that is
   * genuinely unopenable backs off instead of spinning. The socket's own
   * failure count is a trigger alongside the REST error, because after a
   * release the socket is what notices first — and, once nothing is
   * refetching on a timer, may be the only thing that notices at all.
   */
  const reopening = useRef(false);
  const reopenedAt = useRef(0);
  const REOPEN_COOLDOWN_MS = 10_000;
  const socketGaveUp = live.status === "closed" && live.failures >= 2;

  /**
   * Returning to a backgrounded tab, as its own trigger.
   *
   * The failure-driven path above assumes the retry timer is running, and in
   * a hidden tab it effectively is not: browsers throttle background timers
   * to about once a minute and freeze them outright on mobile. So the tab
   * that has been away longest — the one whose session is certainly gone —
   * is the one least able to notice on its own, and it would sit on a stale
   * snapshot until a throttled timer happened to fire.
   *
   * Coming back is therefore treated as a reason to check, not to wait: the
   * cooldown is cleared, because a returning user must never inherit a
   * backoff accrued while they were away, and the state query is refetched
   * so a released session surfaces as an error the effect below acts on.
   */
  const [wake, setWake] = useState(0);
  useEffect(() => {
    const onWake = (): void => {
      if (document.visibilityState !== "visible") return;
      reopenedAt.current = 0;
      setWake(value => value + 1);
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  // A wake tells us to look, not what we will find: the snapshot in hand was
  // taken before the tab went away. Refetch, then let the effect below judge.
  useEffect(() => {
    if (wake === 0 || !sessionKey) return;
    void state.refetch();
  }, [wake, sessionKey]);
  useEffect(() => {
    if (!sessionKey || !workspaces.data) return;
    if (!state.isError && !socketGaveUp) return;
    if (reopening.current) return;
    if (Date.now() - reopenedAt.current < REOPEN_COOLDOWN_MS) return;
    const summary = workspaces.data
      .flatMap(workspace => workspace.sessions)
      .find(session => session.id === sessionKey);
    if (!summary) return;
    reopening.current = true;
    reopenedAt.current = Date.now();
    // Reopening the same file yields the same session id, so the URL stays valid.
    openSession.mutate(
      { body: { sessionPath: summary.path } },
      {
        onSuccess: () => {
          reopening.current = false;
          void queryClient.invalidateQueries();
          // The socket is still retrying a key that only just became valid;
          // reconnect now rather than waiting out its backoff.
          live.reconnect();
        },
        onError: error => {
          reopening.current = false;
          fail(error);
        },
      },
    );
    // `wake` is a dependency because a tab returning to a session that was
    // already in error changes none of the others: the error was there
    // before it went away. Without it the check could not re-run at all.
  }, [sessionKey, state.isError, socketGaveUp, workspaces.data, wake]);

  /**
   * The bare root has nothing on it to act on, so the palette is the page:
   * open it on arrival rather than asking for a click first.
   *
   * Only the root route. `/w/$project` is a destination the user navigated
   * to on purpose — greeting there would reopen the palette on top of every
   * workspace they pick, which is navigation being hijacked, not helped.
   *
   * Once per arrival, and only after the workspace listing has landed, so it
   * never opens onto an empty list. Dismissing it leaves the landing buttons
   * to reopen it — the effect will not fight a user who closed it.
   */
  const greeted = useRef(false);
  useEffect(() => {
    if (project || sessionKey) {
      greeted.current = false;
      return;
    }
    if (greeted.current || !workspaces.data) return;
    greeted.current = true;
    openPalette(PALETTE_COMMAND.project, setPaletteQuery);
  }, [project, sessionKey, workspaces.data]);

  const handleOpen = (session: SessionSummary): void => {
    setSwitchingSession(session.title || session.id || "Loading session…");
    openSession.mutate(
      { body: { sessionPath: session.path } },
      {
        onSuccess: result => {
          navigateTo({ project: result.cwd, session: result.key });
          void queryClient.invalidateQueries();
        },
        onError: error => {
          setSwitchingSession(null);
          fail(error);
        },
      },
    );
  };

  const handleNew = (cwd: string): void => {
    setSwitchingSession("Creating session…");
    openSession.mutate(
      { body: { cwd } },
      {
        onSuccess: result => {
          navigateTo({ project: result.cwd, session: result.key });
          void queryClient.invalidateQueries();
        },
        onError: error => {
          setSwitchingSession(null);
          fail(error);
        },
      },
    );
  };

  const handleAddWorkspace = (): void => {
    // The browser cannot pick a server-side directory, so the path is typed.
    const cwd = window.prompt("Absolute path of the directory to work in:");
    if (cwd?.trim()) handleNew(cwd.trim());
  };

  /**
   * Release a live session from the server's memory.
   *
   * The file stays on disk, so this is reversible by opening it again. When it
   * is the session on screen, leave the conversation first: its `getState`
   * would 404 the moment the agent is disposed, and the stale-URL recovery
   * effect would helpfully reopen the very session just stopped.
   */
  const handleStopSession = (session: SessionSummary): void => {
    if (session.id === sessionKey) navigateTo({ project: session.cwd });
    stopSession.mutate(
      { path: { key: session.id } },
      {
        onSuccess: result => {
          notifications.show({
            color: "cyan",
            title: "Session stopped",
            message: result.detail ?? "The live agent was released.",
          });
          void queryClient.invalidateQueries();
        },
        onError: fail,
      },
    );
  };

  /** Erase a session and its artifacts from disk, after an explicit confirm. */
  const handleDeleteSession = (session: SessionSummary): void => {
    const label = session.title || session.firstMessage || "Untitled session";
    if (!window.confirm(`Delete "${label}" and its artifacts from disk? This cannot be undone.`)) {
      return;
    }
    if (session.id === sessionKey) navigateTo({ project: session.cwd });
    deleteSession.mutate(
      { path: { key: session.id } },
      {
        onSuccess: result => {
          notifications.show({
            color: "orange",
            title: "Session deleted",
            message: result.detail ?? label,
          });
          // Erased from disk means erased here too; a cached copy would
          // otherwise outlive the conversation it belongs to.
          void forgetTranscript(session.id);
          void queryClient.invalidateQueries();
        },
        onError: fail,
      },
    );
  };

  const handleCompact = (mode: CompactMode | undefined, focus: string): void => {
    if (!sessionKey) return;
    compactSession.mutate(
      { path: { key: sessionKey }, body: { mode, focus: focus.trim() || undefined } },
      {
        onSuccess: result => {
          notifications.show({
            color: "cyan",
            title: "Context compacted",
            message: result.detail ?? "Done.",
          });
          refresh();
        },
        onError: fail,
      },
    );
  };

  /**
   * Edit or drop a queued message.
   *
   * Both send the text the row was showing as `expected`, so the server can
   * refuse the write if the agent took that message while the panel was open,
   * and both write the returned queue straight into the cache — it is the
   * authoritative answer to "what is still waiting", fresher than a refetch.
   */
  const applyQueue = (next: QueuedMessage[]): void => {
    if (!sessionKey) return;
    queryClient.setQueryData(getListQueueQueryOptions({ path: { key: sessionKey } }).queryKey, next);
    // `queued` on the session state is a count of the same thing.
    void queryClient.invalidateQueries({
      queryKey: getGetStateQueryOptions({ path: { key: sessionKey } }).queryKey,
    });
  };

  const handleQueueEdit = (message: QueuedMessage, text: string): void => {
    if (!sessionKey) return;
    editQueued.mutate(
      {
        path: { key: sessionKey },
        body: { lane: message.lane, index: message.index, expected: message.text, text },
      },
      { onSuccess: applyQueue, onError: fail },
    );
  };

  const handleQueueDrop = (message: QueuedMessage): void => {
    if (!sessionKey) return;
    dropQueued.mutate(
      {
        path: { key: sessionKey },
        body: { lane: message.lane, index: message.index, expected: message.text },
      },
      { onSuccess: applyQueue, onError: fail },
    );
  };

  /**
   * A shake drops content the reader cannot see being dropped.
   *
   * The notification says what happened; the shake is what makes it felt.
   * The class is removed on animation end so the next shake replays it.
   */
  const [shaking, setShaking] = useState(false);
  const handleShake = (mode: ShakeMode): void => {
    if (!sessionKey) return;
    shakeSession.mutate(
      { path: { key: sessionKey }, body: { mode } },
      {
        onSuccess: result => {
          notifications.show({ color: "cyan", title: "Context shaken", message: result.detail ?? "Done." });
          setShaking(true);
          refresh();
        },
        onError: fail,
      },
    );
  };

  const handleSetThinking = (level: ThinkingLevel): void => {
    if (!sessionKey) return;
    setThinking.mutate(
      { path: { key: sessionKey }, body: { level } },
      {
        onSuccess: () => {
          notifications.show({ color: "cyan", title: "Thinking level", message: level });
          refresh();
        },
        onError: fail,
      },
    );
  };

  /** A new title changes the session listing too, so everything is refetched. */
  const handleRename = (title: string): void => {
    if (!sessionKey) return;
    renameSession.mutate(
      { path: { key: sessionKey }, body: { title } },
      {
        onSuccess: () => void queryClient.invalidateQueries(),
        onError: fail,
      },
    );
  };

  const handleRetry = (): void => {
    if (!sessionKey) return;
    // The retried turn arrives as AG-UI frames, so the stream has to be up
    // before it starts — the same reason `handleSend` reconnects.
    if (live.status !== "open") live.reconnect();
    retryTurn.mutate(
      { path: { key: sessionKey } },
      {
        onSuccess: result => {
          notifications.show({
            color: result.ok ? "cyan" : "yellow",
            title: "Retry",
            message: result.detail ?? "",
          });
          refresh();
        },
        onError: fail,
      },
    );
  };

  const handleAbort = (): void => {
    if (!sessionKey) return;
    abort.mutate({ path: { key: sessionKey } }, { onError: fail });
  };

  /**
   * Toggle plan mode. Shared by the header switch and `/plan`, so the two
   * controls cannot drift apart.
   */
  const handleSetPlanMode = (enabled: boolean): void => {
    if (!sessionKey) return;
    setPlanMode.mutate(
      { path: { key: sessionKey }, body: { enabled } },
      {
        // Turning plan mode on does not create a plan; the drawer opens by
        // itself once the agent has actually written one.
        onSuccess: refresh,
        onError: fail,
      },
    );
  };

  /**
   * Fork: omp moves this live agent onto a fresh session file with a new id,
   * so the URL has to follow the key the server reports back.
   */
  const handleFork = (): void => {
    if (!sessionKey) return;
    setSwitchingSession("Forking session…");
    forkSession.mutate(
      { path: { key: sessionKey } },
      {
        onSuccess: next => {
          notifications.show({
            color: "cyan",
            title: "Session forked",
            message: "Continuing in the copy; the original stays on disk.",
          });
          navigateTo({ project: next.cwd, session: next.key });
          void queryClient.invalidateQueries();
        },
        onError: error => {
          setSwitchingSession(null);
          fail(error);
        },
      },
    );
  };
  /**
   * Ask a transient side question against the current context.
   */
  const handleAskBtw = useCallback(
    (question: string): void => {
      if (!sessionKey) return;
      const q = question.trim();
      if (!q) return;
      setBtwTurns(prev => [...prev, { question: q, loading: true }]);
      openBtw();
      askBtw.mutate(
        { path: { key: sessionKey }, body: { question: q } },
        {
          onSuccess: result => {
            setBtwTurns(prev =>
              prev.map(turn =>
                turn.question === q && turn.loading
                  ? { ...turn, answer: result.answer, loading: false }
                  : turn,
              ),
            );
          },
          onError: error => {
            const problem = error instanceof ApiError ? (error.body as Problem | undefined) : undefined;
            setBtwTurns(prev =>
              prev.map(turn =>
                turn.question === q && turn.loading
                  ? {
                      ...turn,
                      error: problem?.detail ?? (error instanceof Error ? error.message : String(error)),
                      loading: false,
                    }
                  : turn,
              ),
            );
          },
        },
      );
    },
    [sessionKey, askBtw, openBtw],
  );

  /**
   * Synthesize a TTSR stream rule from an agent mistake.
   */
  const handleStartOmfg = useCallback(
    (complaint: string): void => {
      if (!sessionKey) return;
      const c = complaint.trim();
      if (!c) return;
      setOmfgComplaint(c);
      setOmfgCandidate(undefined);
      openOmfg();
      analyzeOmfg.mutate(
        { path: { key: sessionKey }, body: { complaint: c } },
        {
          onSuccess: candidate => {
            setOmfgCandidate(candidate);
          },
          onError: fail,
        },
      );
    },
    [sessionKey, analyzeOmfg, openOmfg],
  );

  const handleAmendOmfg = useCallback(
    (feedback: string): void => {
      if (!sessionKey) return;
      analyzeOmfg.mutate(
        {
          path: { key: sessionKey },
          body: {
            complaint: omfgComplaint,
            feedback,
            previousRule: omfgCandidate?.fileContent,
          },
        },
        {
          onSuccess: candidate => {
            setOmfgCandidate(candidate);
          },
          onError: fail,
        },
      );
    },
    [sessionKey, analyzeOmfg, omfgComplaint, omfgCandidate],
  );

  const handleSaveOmfg = useCallback(
    (name: string, fileContent: string, scope: "project" | "global"): void => {
      if (!sessionKey) return;
      saveOmfg.mutate(
        { path: { key: sessionKey }, body: { name, fileContent, scope } },
        {
          onSuccess: result => {
            notifications.show({
              color: "cyan",
              title: "Rule saved",
              message: result.detail ?? `Saved rule "${name}".`,
            });
            closeOmfg();
          },
          onError: fail,
        },
      );
    },
    [sessionKey, saveOmfg, closeOmfg],
  );

  /**
   * Manage MCP servers.
   */
  const handleAddMcp = useCallback(
    async (req: AddMcpServerRequest): Promise<void> => {
      await addMcp.mutateAsync({ body: { ...req, cwd: project } });
    },
    [addMcp, project],
  );

  const handleRemoveMcp = useCallback(
    async (req: RemoveMcpServerRequest): Promise<void> => {
      await removeMcp.mutateAsync({ body: { ...req, cwd: project } });
    },
    [removeMcp, project],
  );

  const handleTestMcp = useCallback(
    async (req: TestMcpServerRequest): Promise<TestMcpServerResult> => {
      return await testMcp.mutateAsync({ body: { ...req, cwd: project } });
    },
    [testMcp, project],
  );

  const handleToggleMcp = useCallback(
    async (req: ToggleMcpServerRequest): Promise<void> => {
      await toggleMcp.mutateAsync({ body: { ...req, cwd: project } });
      void mcpServers.refetch();
    },
    [toggleMcp, project, mcpServers],
  );

  const handleMutateTodos = useCallback(
    async (req: MutateTodosRequest): Promise<void> => {
      if (!sessionKey) return;
      await mutateTodos.mutateAsync({ path: { key: sessionKey }, body: req });
      void state.refetch();
    },
    [sessionKey, mutateTodos, state],
  );

  const handleOpenMcp = useCallback((): void => {
    openMcp();
    void mcpServers.refetch();
  }, [openMcp, mcpServers]);

  /**
   * Branch: same re-keying as a fork, plus the message text to re-edit.
   *
   * Keyed on the entry id alone, because both callers already have one: the
   * palette from its branch-point list, and a user message in the transcript
   * from the entry it was written as.
   */
  const handleBranch = useCallback(
    (entryId: string): void => {
      if (!sessionKey) return;
      setSwitchingSession("Branching session…");
      branchSession.mutate(
        { path: { key: sessionKey }, body: { entryId } },
        {
          onSuccess: result => {
            navigateTo({ project: result.state.cwd, session: result.state.key });
            setDraft({ text: result.draft });
            notifications.show({
              color: "cyan",
              title: "Branched",
              message: "That message is back in the composer, ready to edit.",
            });
            void queryClient.invalidateQueries();
          },
          onError: error => {
            setSwitchingSession(null);
            fail(error);
          },
        },
      );
    },
    [sessionKey, branchSession, navigateTo, queryClient],
  );

  /**
   * Dismiss an A2UI surface.
   */
  const handleDismissSurface = useCallback(
    (surfaceId: string): void => {
      if (!sessionKey) return;
      dismissSurface.mutate(
        { path: { key: sessionKey }, body: { surfaceId } },
        {
          onSuccess: () => {
            notifications.show({
              color: "plum",
              title: "Surface dismissed",
              message: `Dismissed surface "${surfaceId}".`,
              autoClose: 2000,
            });
          },
          onError: fail,
        },
      );
    },
    [sessionKey, dismissSurface],
  );

  /**
   * Tool and rule operations.
   */
  const handleForceTool = useCallback(
    (toolName: string): void => {
      if (!sessionKey) return;
      forceTool.mutate(
        { path: { key: sessionKey }, body: { toolName } },
        {
          onSuccess: () => {
            void toolsQuery.refetch();
            notifications.show({
              color: "cyan",
              title: "Tool forced",
              message: `Next turn forced to use "${toolName}".`,
            });
          },
          onError: fail,
        },
      );
    },
    [sessionKey, forceTool, toolsQuery],
  );

  const handleClearForceTool = useCallback((): void => {
    if (!sessionKey) return;
    forceTool.mutate(
      { path: { key: sessionKey }, body: { clear: true } },
      {
        onSuccess: () => {
          void toolsQuery.refetch();
          notifications.show({
            color: "plum",
            title: "Cleared",
            message: "Cleared forced tool choice.",
          });
        },
        onError: fail,
      },
    );
  }, [sessionKey, forceTool, toolsQuery]);

  const handleDeleteRule = useCallback(
    async (req: DeleteRuleRequest): Promise<void> => {
      if (!sessionKey) return;
      await deleteRule.mutateAsync({ path: { key: sessionKey }, body: req });
    },
    [sessionKey, deleteRule],
  );

  const handleOpenTools = useCallback((): void => {
    openTools();
    void toolsQuery.refetch();
  }, [openTools, toolsQuery]);

  const handleOpenRules = useCallback((): void => {
    openRules();
    void rulesQuery.refetch();
  }, [openRules, rulesQuery]);

  /**
   * Job and process operations.
   */
  const handleCancelJob = useCallback(
    async (req: CancelJobRequest): Promise<void> => {
      if (!sessionKey) return;
      await cancelJob.mutateAsync({ path: { key: sessionKey }, body: req });
    },
    [sessionKey, cancelJob],
  );

  const handleSignalProcess = useCallback(
    async (req: SignalProcessRequest): Promise<void> => {
      await signalProc.mutateAsync({ body: { ...req, cwd: project } });
    },
    [signalProc, project],
  );

  const handleStopProcess = useCallback(
    async (req: ProcessActionRequest): Promise<void> => {
      await stopProc.mutateAsync({ body: { ...req, cwd: project } });
    },
    [stopProc, project],
  );

  const handleRestartProcess = useCallback(
    async (req: ProcessActionRequest): Promise<void> => {
      await restartProc.mutateAsync({ body: { ...req, cwd: project } });
    },
    [restartProc, project],
  );

  const handleOpenJobs = useCallback((): void => {
    openJobs();
    void jobsQuery.refetch();
  }, [openJobs, jobsQuery]);

  const handleOpenProcesses = useCallback((): void => {
    openProcesses();
    void processesQuery.refetch();
  }, [openProcesses, processesQuery]);
  /**
   * Picking an MCP command writes it into the composer rather than sending it.
   *
   * These commands take arguments, and omp expands them server-side when the
   * message is sent — so the useful thing is to hand the user a started line
   * they can finish, not to fire a prompt they never got to read.
   */
  const handlePickCommand = useCallback((name: string): void => {
    setDraft({ text: `/${name} ` });
  }, []);

  /**
   * Picking a file — from the `@` palette, the file tree, or the viewer —
   * hands the path to the composer, which splices it in as an `@` mention.
   */
  const handlePickFile = useCallback((path: string): void => {
    setInsertedFile(current => ({ path, id: (current?.id ?? 0) + 1 }));
  }, []);

  /**
   * Send a message, echoing it locally at once.
   *
   * The persisted user message only arrives with the next transcript fetch,
   * and the turn that triggers one can take minutes — or fail outright, which
   * emits `RUN_ERROR` rather than `agent_end`. Without the echo the message a
   * user just typed could stay invisible indefinitely.
   */
  const handleSend = (
    message: string,
    deliverAs: "steer" | "followUp" | undefined,
    attachments: Attachment[] | undefined,
    onFailure?: () => void,
  ): void => {
    if (!sessionKey) return;
    if (
      settings.notifyOnYield &&
      typeof Notification !== "undefined" &&
      Notification.permission === "default"
    ) {
      void Notification.requestPermission();
    }
    if (live.status !== "open") live.reconnect();
    setPendingUser(current => [...current, message]);
    // Identifies this send across every retry the outbox makes, so a message
    // parked with no network is delivered exactly once however many times it
    // is replayed.
    const idempotencyKey = newSendId();
    prompt.mutate(
      { path: { key: sessionKey }, body: { message, deliverAs, attachments, idempotencyKey } },
      {
        // Pull the persisted copy in immediately rather than waiting for the
        // turn to settle.
        onSuccess: refresh,
        onError: error => {
          setPendingUser(current => {
            const at = current.indexOf(message);
            if (at < 0) return current;
            return [...current.slice(0, at), ...current.slice(at + 1)];
          });
          onFailure?.();
          fail(error);
        },
      },
    );
  };

  /**
   * The composer's send, which carries the pending annotations with it.
   *
   * Marking something up is a way of pointing at it, so the references go out
   * as text the agent can read and the user never retypes a path. A bare
   * slash command is left alone: the server matches those by whole-string
   * equality, and the annotations keep until there is a real message to
   * attach them to.
   *
   * They are cleared as the send leaves, not when it lands — a message with
   * no network sits in the outbox for as long as it takes, and holding the
   * annotations open that whole time would send them twice. A send that is
   * actually refused puts them back.
   */
  const handleComposerSend = (
    message: string,
    deliverAs: "steer" | "followUp" | undefined,
    attachments: Attachment[] | undefined,
  ): void => {
    if (mobileComposerOverFile) {
      setMobileComposerOverFile(false);
    }
    const pending = annotations.annotations;
    if (pending.length === 0 || message.startsWith("/")) {
      handleSend(message, deliverAs, attachments);
      return;
    }
    annotations.clear();
    handleSend(`${message}\n\n${formatAnnotations(pending)}`, deliverAs, attachments, () =>
      annotations.restore(pending),
    );
  };
  const handleSurfaceAction = useCallback(
    (
      surfaceId: string,
      action: A2uiActionEvent,
      context: Record<string, unknown>,
      dataModel?: Record<string, unknown>,
    ) => {
      const userMsg = action.userMessage
        ? typeof action.userMessage === "string"
          ? action.userMessage
          : String(action.userMessage)
        : undefined;

      const lines = [`[Action: ${action.name} on surface "${surfaceId}"]`];
      if (userMsg) lines.push(userMsg);
      if (Object.keys(context).length > 0) {
        lines.push(`Context: ${JSON.stringify(context)}`);
      }
      if (dataModel) {
        lines.push(`DataModel: ${JSON.stringify(dataModel)}`);
      }
      handleSend(lines.join("\n"), undefined, undefined);
    },
    [handleSend],
  );

  const handlePlanAction = (action: PlanAction, feedback: string, tier: string | undefined): void => {
    if (!sessionKey) return;
    resolvePlan.mutate(
      { path: { key: sessionKey }, body: { action, feedback, tier } },
      {
        onSuccess: result => {
          notifications.show({ color: "cyan", title: "Plan", message: result.detail ?? "Done." });
          if (action !== "refine") closePlan();
          // `execute` runs the approved plan in a fresh session; follow it.
          if (result.sessionKey) {
            navigateTo({ project: state.data?.cwd ?? project, session: result.sessionKey });
          }
          void queryClient.invalidateQueries();
        },
        onError: fail,
      },
    );
  };

  const planPanel = (
    <Planning
      plan={plan.data}
      loading={plan.isLoading}
      busy={resolvePlan.isPending}
      compact={narrow}
      onAction={handlePlanAction}
      onSave={content => {
        if (!sessionKey) return;
        editPlan.mutate({ path: { key: sessionKey }, body: { content } }, { onError: fail });
      }}
    />
  );

  const planEnabled = state.data?.plan?.enabled === true;

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={
        treeOpen && !narrow
          ? {
              width: 360,
              breakpoint: "62em",
              collapsed: { desktop: false, mobile: true },
            }
          : undefined
      }
      aside={{
        width: 340,
        breakpoint: "62em",
        collapsed: { desktop: !todoOpen, mobile: true },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="sm" justify="space-between" wrap="nowrap">
          <Group gap={6} wrap="nowrap" align="center" style={{ flex: 1, minWidth: 0 }}>
            {/* The status bar gave back the space the connection badge and the
                plan switch were using, so the workspace survives on a phone. */}
            <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
              <Tooltip label="Switch workspace or open any session (/cd)" position="bottom-start">
                <UnstyledButton
                  onClick={() => openPalette(PALETTE_COMMAND.project, setPaletteQuery)}
                  aria-label="Switch workspace"
                  style={HEADER_LINK}
                >
                  <IconFolder size={13} style={{ flexShrink: 0, marginRight: 4 }} />
                  <Text size="xs" c="dimmed" truncate style={HEADER_UNDERLINE}>
                    {state.data?.cwd
                      ? state.data.cwd.split("/").pop()
                      : (project?.split("/").pop() ?? "choose a workspace")}
                  </Text>
                </UnstyledButton>
              </Tooltip>
              {state.data ? (
                <Text size="xs" c="dimmed" style={HEADER_SEPARATOR}>
                  ·
                </Text>
              ) : null}
            </Group>
            {state.data ? (
              <>
                <Tooltip label="Resume another session in this workspace (/resume)" position="bottom-start">
                  <UnstyledButton
                    onClick={() => openPalette(PALETTE_COMMAND.session, setPaletteQuery)}
                    aria-label="Resume another session"
                    style={HEADER_LINK}
                  >
                    <IconMessage size={13} style={{ flexShrink: 0, marginRight: 4 }} />
                    <Text size="xs" c="dimmed" truncate style={HEADER_UNDERLINE}>
                      {isSessionLoading
                        ? (switchingSession ?? "Loading session…")
                        : (state.data.title ?? "Untitled session")}
                    </Text>
                  </UnstyledButton>
                </Tooltip>
              </>
            ) : null}
            {state.data?.contextUsage && state.data.contextUsage.percent >= 60 ? (
              <Tooltip
                label="Context usage high — click to view breakdown, /compact, or /shake"
                position="bottom-start"
              >
                <UnstyledButton
                  onClick={() => openPalette(PALETTE_COMMAND.context, setPaletteQuery)}
                  aria-label="View context usage breakdown, or reduce context size"
                  style={{ display: "inline-flex", alignItems: "center" }}
                >
                  <Badge
                    size="xs"
                    variant="filled"
                    color={state.data.contextUsage.percent >= 85 ? "red" : "orange"}
                    style={{ flexShrink: 0, cursor: "pointer" }}
                  >
                    {Math.round(state.data.contextUsage.percent)}%
                  </Badge>
                </UnstyledButton>
              </Tooltip>
            ) : null}
          </Group>
          <Group
            gap={narrow ? 2 : "xs"}
            wrap="nowrap"
            display={sessionKey ? undefined : "none"}
            style={{ flexShrink: 0 }}
          >
            {state.data && live.surfaces.length > 0 ? (
              <Tooltip label={surfaceDrawerOpen ? "Hide UI surface" : "Show UI surface"}>
                <Indicator
                  inline
                  label={live.surfaces.length > 1 ? String(live.surfaces.length) : undefined}
                  disabled={live.surfaces.length <= 1}
                  size={13}
                  color="cyan"
                  offset={2}
                >
                  <ActionIcon
                    size={narrow ? "md" : "lg"}
                    variant={surfaceDrawerOpen ? "light" : "subtle"}
                    color="cyan"
                    onClick={toggleSurfaceDrawer}
                    aria-label="Toggle UI surface drawer"
                  >
                    <IconLayout2 size={18} />
                  </ActionIcon>
                </Indicator>
              </Tooltip>
            ) : null}
            {state.data
              ? (() => {
                  const diffCount = gitStatus.data?.files ? Object.keys(gitStatus.data.files).length : 0;
                  return (
                    <Tooltip
                      label={
                        treeOpen
                          ? "Hide files"
                          : diffCount > 0
                            ? `Show files (${diffCount} changed)`
                            : "Show files"
                      }
                    >
                      <Indicator
                        inline
                        disabled={diffCount === 0}
                        label={diffCount > 99 ? "99+" : String(diffCount)}
                        size={13}
                        color="orange"
                        offset={2}
                        styles={{
                          indicator: {
                            fontSize: 8,
                            fontWeight: 700,
                            padding: "0 3px",
                            height: 13,
                            minWidth: 13,
                            lineHeight: "13px",
                          },
                        }}
                      >
                        <ActionIcon
                          size={narrow ? "md" : "lg"}
                          variant={treeOpen ? "light" : "subtle"}
                          color="plum"
                          onClick={toggleTree}
                          aria-label="Toggle file tree"
                        >
                          <IconFolder size={18} />
                        </ActionIcon>
                      </Indicator>
                    </Tooltip>
                  );
                })()
              : null}
            {state.data ? (
              <Tooltip label="Settings (/omega-settings)">
                <ActionIcon
                  size={narrow ? "md" : "lg"}
                  variant="subtle"
                  color="plum"
                  onClick={() => openPalette(PALETTE_COMMAND.settings, setPaletteQuery)}
                  aria-label="Open settings"
                >
                  <IconSettings size={18} />
                </ActionIcon>
              </Tooltip>
            ) : null}
            {(() => {
              const all = (state.data?.todos ?? []).flatMap(phase => phase.tasks);
              const total = all.length;
              const done = all.filter(task => task.status === "completed").length;
              return (
                <Tooltip label={todoOpen ? "Hide tasks" : "Show tasks"}>
                  <Indicator
                    inline
                    disabled={total === 0}
                    label={`${done}/${total}`}
                    size={13}
                    color={done === total ? "cyan" : "plum"}
                    offset={2}
                    styles={{
                      indicator: {
                        fontSize: 8,
                        fontWeight: 700,
                        padding: "0 3px",
                        height: 13,
                        minWidth: 13,
                        lineHeight: "13px",
                      },
                    }}
                  >
                    <ActionIcon
                      size={narrow ? "md" : "lg"}
                      onClick={toggleTodo}
                      color={todoOpen ? "cyan" : "plum"}
                      aria-label="Toggle tasks panel"
                    >
                      <IconListCheck size={18} />
                    </ActionIcon>
                  </Indicator>
                </Tooltip>
              );
            })()}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Aside p={0}>
        <TodoPanel phases={state.data?.todos} onClose={closeTodo} onMutateTodos={handleMutateTodos} />
      </AppShell.Aside>

      {treeOpen && !narrow ? (
        <AppShell.Navbar p={0} style={{ overflow: "hidden" }}>
          <FileTreePanel
            files={files.data ?? []}
            gitStatus={gitStatus.data}
            projectKey={project ?? sessionKey ?? ""}
            workspaceName={state.data?.cwd?.split("/").pop()}
            onOpenFile={path => setViewingFile(path)}
            onInsertRef={handlePickFile}
            onClose={closeTree}
            onRefresh={() => {
              void files.refetch();
              void gitStatus.refetch();
            }}
          />
        </AppShell.Navbar>
      ) : null}

      <ResizableDrawer
        opened={treeOpen && narrow}
        onClose={closeTree}
        position="left"
        size="100%"
        zIndex={400}
        withOverlay
        closeOnClickOutside
        withCloseButton={false}
        padding={0}
        storageKey="tree"
      >
        <FileTreePanel
          files={files.data ?? []}
          gitStatus={gitStatus.data}
          projectKey={project ?? sessionKey ?? ""}
          workspaceName={state.data?.cwd?.split("/").pop()}
          onOpenFile={path => setViewingFile(path)}
          onInsertRef={handlePickFile}
          onClose={closeTree}
          onRefresh={() => {
            void files.refetch();
            void gitStatus.refetch();
          }}
        />
      </ResizableDrawer>

      <ResizableDrawer
        position="right"
        opened={viewingFile !== null}
        onClose={() => setViewingFile(null)}
        size={narrow ? "100%" : 800}
        zIndex={400}
        withOverlay={narrow}
        closeOnClickOutside={narrow}
        withCloseButton={false}
        padding={0}
        storageKey="file-viewer"
      >
        <FileViewer
          filePath={viewingFile}
          cwd={state.data?.cwd}
          gitStatus={viewingFile && gitStatus.data?.files ? gitStatus.data.files[viewingFile] : undefined}
          onInsertRef={handlePickFile}
          onAnnotate={selection => annotations.add({ kind: "file", ...selection })}
          onClose={() => setViewingFile(null)}
        />
      </ResizableDrawer>
      {/* Mobile FAB to pull up / hide composer over file view */}
      {narrow && viewingFile !== null ? (
        mobileComposerOverFile ? (
          <Box
            style={{
              position: "fixed",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 500,
              padding: "10px 12px 12px",
              backgroundColor: "rgba(var(--mantine-color-body-rgb, 15, 17, 23), 0.96)",
              backdropFilter: "blur(12px)",
              borderTop: "1px solid var(--mantine-color-default-border)",
              boxShadow: "0 -4px 24px rgba(0, 0, 0, 0.5)",
            }}
          >
            {/* FAB positioned directly above composer to hide it */}
            <Tooltip label="Hide composer behind file view" position="left">
              <ActionIcon
                size="lg"
                radius="xl"
                variant="filled"
                color="slate"
                onClick={() => setMobileComposerOverFile(false)}
                aria-label="Hide composer behind file view"
                style={{
                  position: "absolute",
                  bottom: "100%",
                  marginBottom: 16,
                  right: 20,
                  zIndex: 510,
                  boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
                }}
              >
                <IconChevronDown size={20} />
              </ActionIcon>
            </Tooltip>

            <Composer
              state={state.data}
              offline={!online}
              running={streaming}
              draft={draft}
              planEnabled={planEnabled}
              planPending={setPlanMode.isPending}
              onSend={handleComposerSend}
              onPlanMode={handleSetPlanMode}
              onChangeModel={() => openPalette(PALETTE_COMMAND.model, setPaletteQuery)}
              onChangeThinking={() => openPalette(PALETTE_COMMAND.think, setPaletteQuery)}
              onAbort={handleAbort}
              queued={queued}
              onOpenQueue={openQueue}
              annotations={annotations.annotations.length}
              onOpenAnnotations={openAnnotations}
              onSlash={() => openPaletteCommands(setPaletteQuery)}
              onAt={() => openPaletteFiles(setPaletteQuery)}
              forcedTool={toolsQuery.data?.forcedTool}
              onClearForcedTool={handleClearForceTool}
              insertedFile={insertedFile}
              compact={true}
              enterSubmits={settings.enterSubmits}
            />
          </Box>
        ) : (
          <Tooltip label="Compose message over file" position="left">
            <ActionIcon
              size="lg"
              radius="xl"
              variant="filled"
              color="cyan"
              onClick={() => setMobileComposerOverFile(true)}
              aria-label="Pull up composer over file"
              style={{
                position: "fixed",
                bottom: 20,
                right: 20,
                zIndex: 450,
                boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
              }}
            >
              <IconMessage size={20} />
            </ActionIcon>
          </Tooltip>
        )
      ) : null}

      <ResizableDrawer
        opened={planOpen}
        onClose={closePlan}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "92%" : "min(85%, 960px)"}
        title="Planning"
        padding={0}
        storageKey="plan"
      >
        <Box h="100%">{planPanel}</Box>
      </ResizableDrawer>

      {narrow ? (
        <ResizableDrawer
          opened={todoOpen}
          onClose={closeTodo}
          position="right"
          size="85%"
          title={null}
          withCloseButton={false}
          storageKey="todo"
        >
          <TodoPanel phases={state.data?.todos} onClose={closeTodo} onMutateTodos={handleMutateTodos} />
        </ResizableDrawer>
      ) : null}

      <ResizableDrawer
        opened={queueOpen}
        onClose={closeQueue}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "80%" : 460}
        title={queue.data && queue.data.length > 0 ? `Queue — ${queueSummary(queue.data)}` : "Queue"}
        padding={0}
        storageKey="queue"
      >
        <QueuePanel
          messages={queue.data ?? []}
          busy={editQueued.isPending || dropQueued.isPending}
          onEdit={handleQueueEdit}
          onDrop={handleQueueDrop}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={surfaceDrawerOpen && live.surfaces.length > 0}
        onClose={closeSurfaceDrawer}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "92%" : "min(85%, 600px)"}
        storageKey="surface"
        title={
          <Group gap="xs">
            <IconLayout2 size={18} color="var(--mantine-color-cyan-filled)" />
            <Text fw={600} size="sm">
              {live.surfaces.length === 1
                ? `Surface — ${live.surfaces[0]!.surfaceId}`
                : `Surfaces (${live.surfaces.length})`}
            </Text>
          </Group>
        }
        padding="md"
      >
        <Stack gap="lg">
          {live.surfaces.map(surface => (
            <Box key={surface.surfaceId}>
              <Group justify="space-between" align="center" mb={6} wrap="nowrap">
                <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                  {surface.surfaceId}
                </Text>
                <Group gap={4} wrap="nowrap">
                  {/* Only what the agent drew is worth annotating; omega's own
                      telemetry dashboards are not a conversation. */}
                  {isAgentSurface(surface.surfaceId) ? (
                    <>
                      <Tooltip
                        label={penSurface === surface.surfaceId ? "Put the marker down" : "Draw on surface"}
                      >
                        <ActionIcon
                          size="xs"
                          variant={penSurface === surface.surfaceId ? "light" : "subtle"}
                          color="red"
                          onClick={() =>
                            setPenSurface(current =>
                              current === surface.surfaceId ? null : surface.surfaceId,
                            )
                          }
                          aria-label={`Draw on ${surface.surfaceId}`}
                        >
                          <IconPencil size={13} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip
                        label={noteSurface === surface.surfaceId ? "Cancel sticky note" : "Add sticky note"}
                      >
                        <ActionIcon
                          size="xs"
                          variant={noteSurface === surface.surfaceId ? "light" : "subtle"}
                          color="yellow"
                          onClick={() =>
                            setNoteSurface(current =>
                              current === surface.surfaceId ? null : surface.surfaceId,
                            )
                          }
                          aria-label={`Add a sticky note to ${surface.surfaceId}`}
                        >
                          <IconNote size={13} />
                        </ActionIcon>
                      </Tooltip>
                    </>
                  ) : null}
                  <Tooltip label="Dismiss surface">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="gray"
                      onClick={() => handleDismissSurface(surface.surfaceId)}
                      aria-label={`Dismiss ${surface.surfaceId}`}
                    >
                      <IconTrash size={13} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
              <SurfaceAnnotationLayer
                surfaceId={surface.surfaceId}
                annotations={annotations.annotations}
                penArmed={penSurface === surface.surfaceId}
                noteArmed={noteSurface === surface.surfaceId}
                onCommitDrawing={(strokes, targets) =>
                  annotations.add({
                    kind: "drawing",
                    surfaceId: surface.surfaceId,
                    strokes,
                    targets,
                    note: "",
                  })
                }
                onPlaceNote={(x, y, target) =>
                  setEditingNoteId(
                    annotations.add({
                      kind: "note",
                      surfaceId: surface.surfaceId,
                      x,
                      y,
                      target,
                      note: "",
                    }),
                  )
                }
                onMoveNote={annotations.move}
                onUpdateNote={annotations.update}
                onDeleteAnnotation={annotations.remove}
                onDisarmNote={() => setNoteSurface(null)}
                editingNoteId={editingNoteId}
                onEditingDone={() => setEditingNoteId(null)}
              >
                <A2UIRenderer
                  surface={surface}
                  onAction={handleSurfaceAction}
                  onUpdateData={live.updateSurfaceData}
                />
              </SurfaceAnnotationLayer>
            </Box>
          ))}
        </Stack>
      </ResizableDrawer>

      <ResizableDrawer
        opened={subagentDrawerOpen}
        onClose={closeSubagents}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 460}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="subagents"
      >
        <SubagentPanel
          subagents={live.subagents.length > 0 ? live.subagents : (state.data?.subagents ?? [])}
          onClose={closeSubagents}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={btwDrawerOpen}
        onClose={closeBtw}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 460}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="btw"
      >
        <BtwPanel turns={btwTurns} onAsk={handleAskBtw} onClose={closeBtw} />
      </ResizableDrawer>

      <ResizableDrawer
        opened={omfgDrawerOpen}
        onClose={closeOmfg}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="omfg"
      >
        <OmfgPanel
          complaint={omfgComplaint}
          candidate={omfgCandidate}
          loading={analyzeOmfg.isPending}
          saving={saveOmfg.isPending}
          onSave={handleSaveOmfg}
          onAmend={handleAmendOmfg}
          onClose={closeOmfg}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={mcpDrawerOpen}
        onClose={closeMcp}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="mcp"
      >
        <McpPanel
          servers={mcpServers.data?.servers ?? []}
          loading={mcpServers.isFetching}
          onAddServer={handleAddMcp}
          onRemoveServer={handleRemoveMcp}
          onTestServer={handleTestMcp}
          onToggleServer={handleToggleMcp}
          onRefresh={() => void mcpServers.refetch()}
          onClose={closeMcp}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={toolsDrawerOpen}
        onClose={closeTools}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="tools"
      >
        <ToolsPanel
          tools={toolsQuery.data?.tools ?? []}
          forcedTool={toolsQuery.data?.forcedTool}
          loading={toolsQuery.isFetching}
          onForceTool={handleForceTool}
          onClearForce={handleClearForceTool}
          onClose={closeTools}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={rulesDrawerOpen}
        onClose={closeRules}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="rules"
      >
        <RulesPanel
          rules={rulesQuery.data?.rules ?? []}
          loading={rulesQuery.isFetching}
          onDeleteRule={handleDeleteRule}
          onCreateRule={() => {
            closeRules();
            openOmfg();
          }}
          onRefresh={() => void rulesQuery.refetch()}
          onClose={closeRules}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={jobsDrawerOpen}
        onClose={closeJobs}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="jobs"
      >
        <JobsPanel
          running={jobsQuery.data?.running ?? []}
          recent={Array.isArray(jobsQuery.data?.recent) ? jobsQuery.data?.recent : []}
          loading={jobsQuery.isFetching}
          onCancelJob={handleCancelJob}
          onRefresh={() => void jobsQuery.refetch()}
          onClose={closeJobs}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={processDrawerOpen}
        onClose={closeProcesses}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="processes"
      >
        <ProcessPanel
          processes={processesQuery.data?.processes ?? []}
          loading={processesQuery.isFetching}
          onSignalProcess={handleSignalProcess}
          onStopProcess={handleStopProcess}
          onRestartProcess={handleRestartProcess}
          onRefresh={() => void processesQuery.refetch()}
          onClose={closeProcesses}
        />
      </ResizableDrawer>

      <ResizableDrawer
        opened={annotationsOpen}
        onClose={closeAnnotations}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "90%" : 540}
        title={null}
        withCloseButton={false}
        padding={0}
        storageKey="annotations"
      >
        <AnnotationsPanel
          annotations={annotations.annotations}
          onEdit={annotations.update}
          onDelete={annotations.remove}
          onClear={annotations.clear}
          onOpenFile={path => setViewingFile(path)}
          onClose={closeAnnotations}
        />
      </ResizableDrawer>
      <AppShell.Main>
        {isSessionLoading ? (
          <Center style={{ flex: 1, height: "100%", minHeight: "calc(100vh - 120px)" }}>
            <Stack align="center" gap="md">
              <Loader size="xl" color="cyan" type="dots" />
              <Text size="sm" c="dimmed" fw={600}>
                {switchingSession ?? "Loading session…"}
              </Text>
            </Stack>
          </Center>
        ) : sessionKey ? (
          <Stack
            gap={0}
            className={shaking ? "omega-main omega-shaking" : "omega-main"}
            onAnimationEnd={() => setShaking(false)}
          >
            <Transcript
              messages={transcript.data?.messages ?? []}
              liveParts={live.parts}
              pendingUser={pendingUser}
              running={streaming}
              error={live.error ?? (streaming ? undefined : state.data?.lastError)}
              notices={live.notices}
              loading={transcript.isPending}
              onFork={sessionKey ? handleBranch : undefined}
              showThinking={settings.showThinking}
              showToolCalls={settings.showToolCalls}
              subagents={live.subagents.length > 0 ? live.subagents : state.data?.subagents}
              onOpenSubagents={openSubagents}
              hasOlder={transcript.data?.hasMore === true}
              loadingOlder={transcript.isFetching}
              onLoadOlder={() => setTranscriptLimit(current => current + TRANSCRIPT_PAGE)}
              onReload={handleReload}
            >
              <Composer
                state={state.data}
                offline={!online}
                running={streaming}
                draft={draft}
                planEnabled={planEnabled}
                planPending={setPlanMode.isPending}
                onSend={handleComposerSend}
                onPlanMode={handleSetPlanMode}
                onChangeModel={() => openPalette(PALETTE_COMMAND.model, setPaletteQuery)}
                onChangeThinking={() => openPalette(PALETTE_COMMAND.think, setPaletteQuery)}
                onAbort={handleAbort}
                queued={queued}
                onOpenQueue={openQueue}
                annotations={annotations.annotations.length}
                onOpenAnnotations={openAnnotations}
                onSlash={() => openPaletteCommands(setPaletteQuery)}
                onAt={() => openPaletteFiles(setPaletteQuery)}
                forcedTool={toolsQuery.data?.forcedTool}
                onClearForcedTool={handleClearForceTool}
                insertedFile={insertedFile}
                compact={narrow}
                enterSubmits={settings.enterSubmits}
              />
            </Transcript>
          </Stack>
        ) : (
          // Landing: nothing is open, so the only useful action is choosing
          // where to work — which the palette already does, over every
          // workspace and every session on disk. A workspace in the URL is
          // already half that choice, so say so and lead with its sessions
          // rather than repeating the root page.
          <Stack className="omega-main omega-landing" gap="lg" px="md" py="xl" align="center">
            <Stack gap={4} align="center">
              <Text fw={700} size="xl">
                {project ? (project.split("/").pop() ?? project) : "omega"}
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                {project
                  ? `Resume a conversation in ${project}, or start a new one.`
                  : "Pick a workspace to resume a conversation, or start a new one."}
              </Text>
            </Stack>
            <Group gap="sm" justify="center">
              <Button
                size="md"
                color="cyan"
                leftSection={project ? <IconHistory size={18} /> : <IconFolder size={18} />}
                onClick={() =>
                  openPalette(project ? PALETTE_COMMAND.session : PALETTE_COMMAND.project, setPaletteQuery)
                }
              >
                {project ? "Sessions here" : "Workspaces and sessions"}
              </Button>
              {project ? (
                <Button
                  size="md"
                  variant="light"
                  color="plum"
                  leftSection={<IconFolder size={18} />}
                  onClick={() => openPalette(PALETTE_COMMAND.project, setPaletteQuery)}
                >
                  Another workspace
                </Button>
              ) : null}
            </Group>
            <Text size="xs" c="dimmed" ta="center">
              ⌘⇧K / Ctrl+Shift+K reopens the palette; type / there to see every command.
            </Text>
          </Stack>
        )}
      </AppShell.Main>

      <CommandPalette
        query={paletteQuery}
        onQueryChange={setPaletteQuery}
        models={models.data ?? []}
        recentModels={recentModels}
        workspaces={workspaces.data ?? []}
        mcpCommands={mcpCommands.data ?? []}
        onPickCommand={handlePickCommand}
        files={files.data ?? []}
        onPickFile={handlePickFile}
        settings={settings}
        onToggleSetting={toggleSetting}
        activeProject={project}
        sessionKey={sessionKey}
        state={state.data}
        branchPoints={branchPoints.data ?? []}
        onSelectModel={handleSelectModel}
        onSelectProject={cwd => navigateTo({ project: cwd, session: sessionKey })}
        onOpenSession={handleOpen}
        onNewSession={handleNew}
        onAddWorkspace={handleAddWorkspace}
        onOpenTools={handleOpenTools}
        onOpenRules={handleOpenRules}
        onForceTool={handleForceTool}
        toolsList={toolsQuery.data?.tools}
        forcedTool={toolsQuery.data?.forcedTool}
        onCompact={handleCompact}
        onShake={handleShake}
        onSetThinking={handleSetThinking}
        onOpenJobs={handleOpenJobs}
        onOpenProcesses={handleOpenProcesses}
        onBtw={handleAskBtw}
        onOpenTodos={toggleTodo}
        onMutateTodos={handleMutateTodos}
        onOpenMcp={handleOpenMcp}
        mcpServers={mcpServers.data?.servers ?? []}
        onTestMcp={handleTestMcp}
        onToggleMcp={handleToggleMcp}
        onOmfg={handleStartOmfg}
        onRename={handleRename}
        onRetry={handleRetry}
        onAbort={handleAbort}
        onShowCost={() => handleSend("/cost", undefined, undefined)}
        onShowUsage={() => handleSend("/usage", undefined, undefined)}
        onShowStats={() => handleSend("/stats", undefined, undefined)}
        onShowContext={() => handleSend("/context", undefined, undefined)}
        onShowWorktrees={() => handleSend("/worktrees", undefined, undefined)}
        onCreateWorktree={arg => handleSend(arg ? `/wt ${arg}` : "/wt", undefined, undefined)}
        onShowGc={() => handleSend("/gc", undefined, undefined)}
        onShowChangelog={full => handleSend(full ? "/changelog full" : "/changelog", undefined, undefined)}
        onShowSessionInfo={() => handleSend("/session", undefined, undefined)}
        onTogglePlanMode={handleSetPlanMode}
        onFork={handleFork}
        onBranch={point => handleBranch(point.entryId)}
        onStopSession={handleStopSession}
        onDeleteSession={handleDeleteSession}
        onRefreshWorkspaces={() => void workspaces.refetch()}
      />
    </AppShell>
  );
}
