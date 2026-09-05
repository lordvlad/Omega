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
  Burger,
  Drawer,
  Group,
  Indicator,
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import { IconChecklist, IconListCheck, IconPlugConnected, IconRoute } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PlanAction, SessionSummary } from "./api/model.ts";
import {
  useAbort,
  useEditPlan,
  useOpenSession,
  usePrompt,
  useResolvePlan,
  useSelectModel,
  useSetPlanMode,
} from "./api/mutations.ts";
import {
  getGetPlanQueryOptions,
  getGetStateQueryOptions,
  getGetTranscriptQueryOptions,
  useGetPlan,
  useGetState,
  useGetTranscript,
  useListModels,
  useListWorkspaces,
} from "./api/queries.ts";
import { Composer } from "./components/Composer.tsx";
import { Planning } from "./components/Planning.tsx";
import { SessionTree } from "./components/SessionTree.tsx";
import { TodoPanel } from "./components/TodoPanel.tsx";
import { Transcript } from "./components/Transcript.tsx";
import { useLiveTurn } from "./lib/stream.ts";

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
  const [navOpen, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const [todoOpen, setTodoOpen] = useState(false);
  /** Sent messages not yet echoed back by the server transcript. */
  const [pendingUser, setPendingUser] = useState<string[]>([]);

  // One breakpoint drives every layout decision, so the surfaces cannot
  // disagree about whether this is a phone.
  const narrow = useMediaQuery("(max-width: 62em)") ?? false;
  const queryClient = useQueryClient();

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
  const plan = useGetPlan({ path: { key: sessionKey ?? "" } }, { enabled: Boolean(sessionKey) });

  // The stream tells us when snapshot state went stale; refetching beats
  // mirroring omp's whole state machine in the client.
  const refresh = useCallback(() => {
    if (!sessionKey) return;
    const path = { path: { key: sessionKey } };
    void queryClient.invalidateQueries({ queryKey: getGetStateQueryOptions(path).queryKey });
    void queryClient.invalidateQueries({ queryKey: getGetTranscriptQueryOptions(path).queryKey });
    void queryClient.invalidateQueries({ queryKey: getGetPlanQueryOptions(path).queryKey });
  }, [queryClient, sessionKey]);

  const live = useLiveTurn(sessionKey, refresh);

  const openSession = useOpenSession();
  const prompt = usePrompt();
  const abort = useAbort();
  const selectModel = useSelectModel();
  const setPlanMode = useSetPlanMode();
  const resolvePlan = useResolvePlan();
  const editPlan = useEditPlan();

  const fail = (error: unknown): void => {
    notifications.show({
      color: "red",
      title: "Request failed",
      message: error instanceof Error ? error.message : String(error),
    });
  };

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

  // Retire each echo as soon as the fetched transcript contains it, matching on
  // text rather than position so a steer landing out of order still clears and
  // no message is ever rendered twice.
  useEffect(() => {
    const persisted = transcript.data?.messages;
    if (!persisted) return;
    const sent = new Set(
      persisted
        .filter(message => message.role === "user")
        .map(message => message.parts.map(part => part.text).join("\n")),
    );
    if (sent.size === 0) return;
    setPendingUser(current =>
      current.some(text => sent.has(text)) ? current.filter(text => !sent.has(text)) : current,
    );
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

  const handleOpen = (session: SessionSummary): void => {
    openSession.mutate(
      { body: { sessionPath: session.path } },
      {
        onSuccess: result => {
          navigateTo({ project: result.cwd, session: result.key });
          closeNav();
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
          closeNav();
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
   * Send a message, echoing it locally at once.
   *
   * The persisted user message only arrives with the next transcript fetch,
   * and the turn that triggers one can take minutes — or fail outright, which
   * emits `RUN_ERROR` rather than `agent_end`. Without the echo the message a
   * user just typed could stay invisible indefinitely.
   */
  const handleSend = (message: string, deliverAs: "steer" | "followUp" | undefined): void => {
    if (!sessionKey) return;
    setPendingUser(current => [...current, message]);
    prompt.mutate(
      { path: { key: sessionKey }, body: { message, deliverAs } },
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
      navbar={{ width: 300, breakpoint: "62em", collapsed: { mobile: true, desktop: false } }}
      aside={{
        width: 340,
        breakpoint: "62em",
        collapsed: { desktop: !todoOpen, mobile: true },
      }}
      padding={0}
    >
      <AppShell.Header>
        <Group h="100%" px="sm" justify="space-between" wrap="nowrap">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            {narrow ? <Burger opened={navOpen} onClick={toggleNav} size="sm" /> : null}
            <Box style={{ minWidth: 0 }}>
              <Text fw={700} size="sm" truncate>
                {state.data?.title ?? "omega"}
              </Text>
              {state.data ? (
                <Group gap={6} wrap="nowrap" align="center">
                  <Text size="xs" c="dimmed" truncate style={{ minWidth: 0 }}>
                    {state.data.modelName} · {state.data.cwd}
                  </Text>
                  {state.data.contextUsage && state.data.contextUsage.percent >= 60 ? (
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
              ) : (
                <Text size="xs" c="dimmed">
                  no session open
                </Text>
              )}
            </Box>
          </Group>

          <Group gap="xs" wrap="nowrap" display={sessionKey ? undefined : "none"}>
            <Tooltip
              label={
                live.status === "open"
                  ? "Streaming"
                  : live.status === "connecting"
                    ? "Connecting"
                    : "Disconnected"
              }
            >
              <Badge
                size="sm"
                variant="light"
                color={live.status === "open" ? "cyan" : live.status === "connecting" ? "yellow" : "red"}
                leftSection={<IconPlugConnected size={12} />}
              >
                {live.running ? "running" : live.status}
              </Badge>
            </Tooltip>

            <Tooltip
              label="Plan mode: agent researches and drafts a plan before modifying code"
              withinPortal
              multiline
              w={220}
            >
              <Group gap={6} wrap="nowrap" style={{ cursor: "pointer" }}>
                <Text size="xs" fw={600} c={planEnabled ? "cyan" : "dimmed"}>
                  Plan
                </Text>
                <Switch
                  size="sm"
                  color="cyan"
                  checked={planEnabled}
                  disabled={!sessionKey || setPlanMode.isPending}
                  onChange={event => {
                    if (!sessionKey) return;
                    const enabled = event.currentTarget.checked;
                    setPlanMode.mutate(
                      { path: { key: sessionKey }, body: { enabled } },
                      {
                        onSuccess: () => {
                          if (enabled) setPlanOpen(true);
                          refresh();
                        },
                        onError: fail,
                      },
                    );
                  }}
                  aria-label="Toggle plan mode"
                />
              </Group>
            </Tooltip>

            <Tooltip label={planOpen ? "Hide the plan" : "Show the plan"}>
              <ActionIcon
                onClick={() => setPlanOpen(value => !value)}
                disabled={!sessionKey}
                color={planOpen ? "cyan" : "plum"}
                aria-label="Toggle the planning panel"
              >
                <IconRoute size={18} />
              </ActionIcon>
            </Tooltip>

            {(() => {
              const all = (state.data?.todos ?? []).flatMap(p => p.tasks);
              const total = all.length;
              const done = all.filter(t => t.status === "completed").length;
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

      <AppShell.Navbar p={0}>
        <SessionTree
          workspaces={workspaces.data ?? []}
          loading={workspaces.isFetching}
          activeSessionId={sessionKey}
          activeProject={project}
          onSelectProject={cwd => navigateTo({ project: cwd ?? undefined, session: sessionKey })}
          onOpenSession={handleOpen}
          onNewSession={handleNew}
          onAddWorkspace={handleAddWorkspace}
          onRefresh={() => void workspaces.refetch()}
        />
      </AppShell.Navbar>

      {narrow ? (
        <Drawer opened={navOpen} onClose={closeNav} size="85%" title="Sessions" padding={0}>
          <SessionTree
            workspaces={workspaces.data ?? []}
            loading={workspaces.isFetching}
            activeSessionId={sessionKey}
            activeProject={project}
            onSelectProject={cwd => navigateTo({ project: cwd ?? undefined, session: sessionKey })}
            onOpenSession={handleOpen}
            onNewSession={handleNew}
            onAddWorkspace={handleAddWorkspace}
            onRefresh={() => void workspaces.refetch()}
          />
        </Drawer>
      ) : null}
      <AppShell.Aside p={0}>
        <TodoPanel phases={state.data?.todos} onClose={() => setTodoOpen(false)} />
      </AppShell.Aside>

      <Drawer
        opened={planOpen}
        onClose={() => setPlanOpen(false)}
        position={narrow ? "bottom" : "right"}
        size={narrow ? "92%" : 520}
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
            />
            <Composer
              state={state.data}
              models={models.data ?? []}
              modelsLoading={models.isLoading}
              running={live.running || state.data?.streaming === true}
              onSend={handleSend}
              onAbort={() => {
                if (sessionKey) abort.mutate({ path: { key: sessionKey } }, { onError: fail });
              }}
              onSelectModel={ref => {
                if (!sessionKey) return;
                selectModel.mutate(
                  { path: { key: sessionKey }, body: { ref } },
                  { onSuccess: refresh, onError: fail },
                );
              }}
            />
          </Stack>
        ) : (
          // Landing: the same session tree as the nav, framed as a page. An
          // empty composer over an empty transcript offered nothing to do; the
          // one useful action here is choosing where to work.
          <Stack className="omega-main omega-landing" gap="lg" px="md" py="xl">
            <Stack gap={4} align="center">
              <Text fw={700} size="xl">
                omega
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Pick a workspace to resume a conversation, or start a new one.
              </Text>
            </Stack>
            <Box className="omega-landing-tree">
              <SessionTree
                framing="page"
                workspaces={workspaces.data ?? []}
                loading={workspaces.isFetching}
                activeSessionId={sessionKey}
                activeProject={project}
                onSelectProject={cwd => navigateTo({ project: cwd ?? undefined })}
                onOpenSession={handleOpen}
                onNewSession={handleNew}
                onAddWorkspace={handleAddWorkspace}
                onRefresh={() => void workspaces.refetch()}
              />
            </Box>
          </Stack>
        )}
      </AppShell.Main>
    </AppShell>
  );
}
