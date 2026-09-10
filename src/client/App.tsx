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
  Drawer,
  Group,
  Indicator,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useLocalStorage, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconFolder, IconHistory, IconListCheck, IconMessage } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "./api/api.ts";
import type {
  Attachment,
  BranchPoint,
  PlanAction,
  Problem,
  QueuedMessage,
  SessionSummary,
  ShakeMode,
  ThinkingLevel,
} from "./api/model.ts";
import {
  useAbort,
  useBranchSession,
  useCompactSession,
  useDeleteSession,
  useDropQueued,
  useEditPlan,
  useEditQueued,
  useForkSession,
  useOpenSession,
  usePrompt,
  useRenameSession,
  useRenderMarkdown,
  useResolvePlan,
  useRetryTurn,
  useSelectModel,
  useSetPlanMode,
  useSetThinkingLevel,
  useShakeSession,
  useStopSession,
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
  useListQueue,
  useListModels,
  useListWorkspaces,
} from "./api/queries.ts";
import {
  CommandPalette,
  type CompactMode,
  openPalette,
  PALETTE_COMMAND,
} from "./components/CommandPalette.tsx";
import { Composer } from "./components/Composer.tsx";
import { Planning } from "./components/Planning.tsx";
import { QueuePanel, queueSummary } from "./components/QueuePanel.tsx";
import { TodoPanel } from "./components/TodoPanel.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { useOnline } from "./lib/online.ts";
import { useLiveTurn } from "./lib/stream.ts";
import { forgetTranscript, usePersistedTranscript } from "./lib/transcript-cache.ts";

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

  const [planOpen, setPlanOpen] = useState(false);
  /** Controlled palette query; a header hyperlink prefills the command. */
  const [paletteQuery, setPaletteQuery] = useState("");
  const [todoOpen, setTodoOpen] = useState(false);
  /** The queue panel, opened from the composer's queued-message hint. */
  const [queueOpen, setQueueOpen] = useState(false);
  /** Sent messages not yet echoed back by the server transcript. */
  const [pendingUser, setPendingUser] = useState<string[]>([]);
  /** Message text a branch handed back, for the composer to pick up. */
  const [draft, setDraft] = useState<{ text: string } | undefined>(undefined);

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
  const transcript = useGetTranscript({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  // Show the conversation that was on screen last time while the fetch runs,
  // and while a released session is being re-opened.
  usePersistedTranscript(sessionKey, transcript.data);
  const plan = useGetPlan({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });
  const branchPoints = useListBranchPoints(
    { path: { key: sessionKey ?? "" } },
    { enabled: Boolean(sessionKey), staleTime: 5_000 },
  );
  // The stream tells us when snapshot state went stale; refetching beats
  // mirroring omp's whole state machine in the client.
  const refresh = useCallback(() => {
    if (!sessionKey) return;
    const path = { path: { key: sessionKey } };
    void queryClient.invalidateQueries({ queryKey: getGetStateQueryOptions(path).queryKey });
    void queryClient.invalidateQueries({ queryKey: getGetTranscriptQueryOptions(path).queryKey });
    void queryClient.invalidateQueries({ queryKey: getGetPlanQueryOptions(path).queryKey });
  }, [queryClient, sessionKey]);
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

  const live = useLiveTurn(sessionKey, refresh);
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
    setPlanOpen(true);
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
      setPlanOpen(false);
      return;
    }
    if (shownPlan.current === content) return;
    shownPlan.current = content;
    setPlanOpen(true);
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
          ? "This device has no network. Conversations you have opened before are still readable; sending waits for the network."
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

  // A URL outlives the process that served it: a shared link, a reload, or a
  // server restart all arrive with a session id the registry has never
  // opened, so `getState` 404s. The workspace listing already carries every
  // session's id and file, so resolve the id there and load it once.
  const reopened = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!sessionKey || !state.isError || !workspaces.data) return;
    if (reopened.current === sessionKey) return;
    const summary = workspaces.data
      .flatMap(workspace => workspace.sessions)
      .find(session => session.id === sessionKey);
    if (!summary) return;
    reopened.current = sessionKey;
    // Reopening the same file yields the same session id, so the URL stays valid.
    openSession.mutate(
      { body: { sessionPath: summary.path } },
      {
        onSuccess: () => void queryClient.invalidateQueries(),
        onError: fail,
      },
    );
  }, [sessionKey, state.isError, workspaces.data]);

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
    openSession.mutate(
      { body: { sessionPath: session.path } },
      {
        onSuccess: result => {
          navigateTo({ project: result.cwd, session: result.key });
          void queryClient.invalidateQueries();
        },
        onError: fail,
      },
    );
  };

  const handleNew = (cwd: string): void => {
    openSession.mutate(
      { body: { cwd } },
      {
        onSuccess: result => {
          navigateTo({ project: result.cwd, session: result.key });
          void queryClient.invalidateQueries();
        },
        onError: fail,
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

  const handleShake = (mode: ShakeMode): void => {
    if (!sessionKey) return;
    shakeSession.mutate(
      { path: { key: sessionKey }, body: { mode } },
      {
        onSuccess: result => {
          notifications.show({ color: "cyan", title: "Context shaken", message: result.detail ?? "Done." });
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
        onError: fail,
      },
    );
  };

  /** Branch: same re-keying as a fork, plus the message text to re-edit. */
  const handleBranch = (point: BranchPoint): void => {
    if (!sessionKey) return;
    branchSession.mutate(
      { path: { key: sessionKey }, body: { entryId: point.entryId } },
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
        onError: fail,
      },
    );
  };

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
  ): void => {
    if (!sessionKey) return;
    if (live.status !== "open") live.reconnect();
    setPendingUser(current => [...current, message]);
    prompt.mutate(
      { path: { key: sessionKey }, body: { message, deliverAs, attachments } },
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
          fail(error);
        },
      },
    );
  };

  const handlePlanAction = (action: PlanAction, feedback: string, tier: string | undefined): void => {
    if (!sessionKey) return;
    resolvePlan.mutate(
      { path: { key: sessionKey }, body: { action, feedback, tier } },
      {
        onSuccess: result => {
          notifications.show({ color: "cyan", title: "Plan", message: result.detail ?? "Done." });
          // `execute` runs the approved plan in a fresh session; follow it.
          if (result.sessionKey) navigateTo({ project: state.data?.cwd, session: result.sessionKey });
          if (action !== "refine") setPlanOpen(false);
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
                      {state.data.title ?? "Untitled session"}
                    </Text>
                  </UnstyledButton>
                </Tooltip>
              </>
            ) : null}
            {state.data?.contextUsage && state.data.contextUsage.percent >= 60 ? (
              <Badge
                size="xs"
                variant="filled"
                color={state.data.contextUsage.percent >= 85 ? "red" : "orange"}
                style={{ flexShrink: 0 }}
              >
                {Math.round(state.data.contextUsage.percent)}%
              </Badge>
            ) : null}
          </Group>
          <Group gap="xs" wrap="nowrap" display={sessionKey ? undefined : "none"} style={{ flexShrink: 0 }}>
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
                      onClick={() => setTodoOpen(value => !value)}
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
        <TodoPanel phases={state.data?.todos} onClose={() => setTodoOpen(false)} />
      </AppShell.Aside>

      <Drawer
        opened={planOpen}
        onClose={() => setPlanOpen(false)}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "92%" : "min(85%, 960px)"}
        title="Planning"
        padding={0}
      >
        <Box h="100%">{planPanel}</Box>
      </Drawer>

      {narrow ? (
        <Drawer
          opened={todoOpen}
          onClose={() => setTodoOpen(false)}
          position="right"
          size="85%"
          title="Tasks & Todos"
          padding={0}
        >
          <TodoPanel phases={state.data?.todos} onClose={() => setTodoOpen(false)} />
        </Drawer>
      ) : null}

      <Drawer
        opened={queueOpen}
        onClose={() => setQueueOpen(false)}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "80%" : 460}
        title={queue.data && queue.data.length > 0 ? `Queue — ${queueSummary(queue.data)}` : "Queue"}
        padding={0}
      >
        <QueuePanel
          messages={queue.data ?? []}
          busy={editQueued.isPending || dropQueued.isPending}
          onEdit={handleQueueEdit}
          onDrop={handleQueueDrop}
        />
      </Drawer>

      <AppShell.Main>
        {sessionKey ? (
          <Stack gap={0} className="omega-main">
            <Transcript
              messages={transcript.data?.messages ?? []}
              liveParts={live.parts}
              pendingUser={pendingUser}
              running={live.running}
              error={live.error}
              notices={live.notices}
              loading={transcript.isPending}
            />
            <Composer
              state={state.data}
              offline={!online}
              running={streaming}
              draft={draft}
              planEnabled={planEnabled}
              planPending={setPlanMode.isPending}
              onSend={handleSend}
              onPlanMode={handleSetPlanMode}
              onChangeModel={() => openPalette(PALETTE_COMMAND.model, setPaletteQuery)}
              onAbort={handleAbort}
              queued={queued}
              onOpenQueue={() => setQueueOpen(true)}
              compact={narrow}
            />
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
        activeProject={project}
        sessionKey={sessionKey}
        state={state.data}
        branchPoints={branchPoints.data ?? []}
        onSelectModel={handleSelectModel}
        onSelectProject={cwd => navigateTo({ project: cwd, session: sessionKey })}
        onOpenSession={handleOpen}
        onNewSession={handleNew}
        onAddWorkspace={handleAddWorkspace}
        onCompact={handleCompact}
        onShake={handleShake}
        onSetThinking={handleSetThinking}
        onRename={handleRename}
        onRetry={handleRetry}
        onAbort={handleAbort}
        onTogglePlanMode={handleSetPlanMode}
        onFork={handleFork}
        onBranch={handleBranch}
        onStopSession={handleStopSession}
        onDeleteSession={handleDeleteSession}
        onRefreshWorkspaces={() => void workspaces.refetch()}
      />
    </AppShell>
  );
}
