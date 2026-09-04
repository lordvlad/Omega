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
  ScrollArea,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { useDisclosure, useLocalStorage, useMediaQuery } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  IconChecklist,
  IconLayoutSidebarRightExpand,
  IconListCheck,
  IconMap2,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

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
  // The open session survives a reload, so a phone that drops the tab comes
  // back to the same conversation.
  const [sessionKey, setSessionKey] = useLocalStorage<string | undefined>({
    key: "omega.session",
    defaultValue: undefined,
    getInitialValueInEffect: false,
  });
  const [planOpen, setPlanOpen] = useState(false);
  const [navOpen, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const [todoOpen, setTodoOpen] = useState(false);

  // One breakpoint drives every layout decision, so the surfaces cannot
  // disagree about whether this is a phone.
  const narrow = useMediaQuery("(max-width: 62em)") ?? false;
  const queryClient = useQueryClient();

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
      color: "lagoon",
      title: "Plan ready for review",
      message: "The agent submitted a plan and is waiting on your decision.",
    });
  }, [live.planAwaiting]);

  const handleOpen = (session: SessionSummary): void => {
    openSession.mutate(
      { body: { sessionPath: session.path } },
      {
        onSuccess: result => {
          setSessionKey(result.key);
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
          setSessionKey(result.key);
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

  const handleSend = (message: string, deliverAs: "steer" | "followUp" | undefined): void => {
    if (!sessionKey) return;
    prompt.mutate({ path: { key: sessionKey }, body: { message, deliverAs } }, { onError: fail });
  };

  const handlePlanAction = (action: PlanAction, feedback: string, tier: string | undefined): void => {
    if (!sessionKey) return;
    resolvePlan.mutate(
      { path: { key: sessionKey }, body: { action, feedback, tier } },
      {
        onSuccess: result => {
          notifications.show({ color: "lagoon", title: "Plan", message: result.detail ?? "Done." });
          // `execute` runs the approved plan in a fresh session; follow it.
          if (result.sessionKey) setSessionKey(result.sessionKey);
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
              <Text size="xs" c="dimmed" truncate>
                {state.data ? `${state.data.modelName} · ${state.data.cwd}` : "no session open"}
              </Text>
            </Box>
          </Group>

          <Group gap="xs" wrap="nowrap">
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
                variant="dot"
                color={live.status === "open" ? "lagoon" : live.status === "connecting" ? "yellow" : "red"}
                leftSection={<IconPlugConnected size={10} />}
              >
                {live.running ? "running" : live.status}
              </Badge>
            </Tooltip>

            <Tooltip label="Plan mode">
              <Switch
                size="sm"
                color="lagoon"
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
                aria-label="Plan mode"
              />
            </Tooltip>

            <Tooltip label={planOpen ? "Hide the plan" : "Show the plan"}>
              <ActionIcon
                onClick={() => setPlanOpen(value => !value)}
                disabled={!sessionKey}
                color={planOpen ? "lagoon" : "plum"}
                aria-label="Toggle the planning panel"
              >
                {narrow ? <IconMap2 size={18} /> : <IconLayoutSidebarRightExpand size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={todoOpen ? "Hide tasks" : "Show tasks"}>
              <ActionIcon
                onClick={() => setTodoOpen(value => !value)}
                color={todoOpen ? "lagoon" : "plum"}
                aria-label="Toggle tasks panel"
                style={{ position: "relative" }}
              >
                <IconListCheck size={18} />
                {(() => {
                  const all = (state.data?.todos ?? []).flatMap(p => p.tasks);
                  const total = all.length;
                  if (total === 0) return null;
                  const done = all.filter(t => t.status === "completed").length;
                  return (
                    <Badge
                      size="xs"
                      variant="filled"
                      color={done === total ? "lagoon" : "plum"}
                      style={{
                        position: "absolute",
                        top: -4,
                        right: -6,
                        padding: "0 4px",
                        height: 14,
                        fontSize: 9,
                      }}
                    >
                      {done}/{total}
                    </Badge>
                  );
                })()}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p={0}>
        <SessionTree
          workspaces={workspaces.data ?? []}
          loading={workspaces.isFetching}
          activeSessionId={sessionKey}
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
        <Stack gap={0} className="omega-main">
          <ScrollArea className="omega-scroll" type="auto" px="sm" pt="sm">
            <Transcript
              messages={transcript.data?.messages ?? []}
              liveParts={live.parts}
              running={live.running}
              error={live.error}
              notices={live.notices}
            />
          </ScrollArea>
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
      </AppShell.Main>
    </AppShell>
  );
}
