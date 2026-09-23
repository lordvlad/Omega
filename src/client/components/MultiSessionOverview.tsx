/**
 * Multi-Session Overview modal.
 *
 * Fullscreen dashboard displaying all currently active/live sessions across
 * workspaces with real-time cards showing working directory, title, git branch,
 * model & thinking tier, agent archetype, current state, message counts, todo
 * counters, and dot status markers (completed, error, streaming, idle).
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Center,
  Group,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheck,
  IconChecklist,
  IconClock,
  IconCpu,
  IconFolder,
  IconGitBranch,
  IconMessage,
  IconPlayerPlayFilled,
  IconPlayerStopFilled,
  IconPlus,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconStack2,
  IconX,
} from "@tabler/icons-react";
import React, { useState } from "react";

import type { ActiveSessionOverview } from "../api/model.ts";

export interface MultiSessionOverviewProps {
  opened: boolean;
  onClose: () => void;
  activeSessions: ActiveSessionOverview[];
  loading?: boolean;
  onSelectSession: (cwd: string, sessionKey: string) => void;
  onNewSession?: (cwd: string) => void;
  onStopSession?: (sessionKey: string) => void;
  onRefresh?: () => void;
}

function formatRelative(ms: number): string {
  if (ms < 5_000) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ago`;
}

function renderDotMarker(dot: ActiveSessionOverview["turnCompletedDot"]): React.ReactNode {
  switch (dot) {
    case "streaming":
      return (
        <Badge
          size="xs"
          color="plum"
          variant="filled"
          className="omega-pulse"
          leftSection={<IconPlayerPlayFilled size={9} />}
        >
          STREAMING
        </Badge>
      );
    case "error":
      return (
        <Badge size="xs" color="red" variant="filled" leftSection={<IconAlertTriangle size={9} />}>
          ERROR
        </Badge>
      );
    case "completed":
      return (
        <Badge size="xs" color="teal" variant="filled" leftSection={<IconCheck size={9} />}>
          COMPLETED
        </Badge>
      );
    case "idle":
    default:
      return (
        <Badge size="xs" color="gray" variant="light">
          IDLE
        </Badge>
      );
  }
}

export function MultiSessionOverview({
  opened,
  onClose,
  activeSessions,
  loading = false,
  onSelectSession,
  onNewSession,
  onStopSession,
  onRefresh,
}: MultiSessionOverviewProps): React.ReactNode {
  const [filterQuery, setFilterQuery] = useState("");

  const filteredSessions = activeSessions.filter(s => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.workdir.toLowerCase().includes(q) ||
      s.cwd.toLowerCase().includes(q) ||
      s.key.toLowerCase().includes(q) ||
      (s.gitBranch && s.gitBranch.toLowerCase().includes(q)) ||
      s.modelName.toLowerCase().includes(q) ||
      s.agentArchetype.toLowerCase().includes(q)
    );
  });

  const streamingCount = activeSessions.filter(s => s.state === "streaming").length;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      fullScreen
      withCloseButton={false}
      padding={0}
      styles={{
        body: {
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "var(--mantine-color-body)",
        },
      }}
    >
      {/* Top Header Bar */}
      <Box
        p="md"
        style={{
          borderBottom: "1px solid var(--omega-line)",
          backgroundColor: "var(--mantine-color-body)",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="lg" radius="md" variant="light" color="cyan">
              <IconStack2 size={20} />
            </ThemeIcon>
            <Box>
              <Group gap="xs" align="center">
                <Text size="md" fw={700}>
                  Active Sessions Overview
                </Text>
                <Badge
                  size="sm"
                  variant="light"
                  color={streamingCount > 0 ? "plum" : activeSessions.length > 0 ? "cyan" : "gray"}
                >
                  {streamingCount > 0
                    ? `${streamingCount} streaming · ${activeSessions.length} active`
                    : `${activeSessions.length} live session${activeSessions.length === 1 ? "" : "s"}`}
                </Badge>
              </Group>
              <Text size="xs" c="dimmed">
                Real-time monitor across all active agent sessions in memory
              </Text>
            </Box>
          </Group>

          <Group gap="xs" wrap="nowrap">
            {onRefresh ? (
              <Tooltip label="Refresh active sessions">
                <ActionIcon
                  size="md"
                  variant="subtle"
                  color="cyan"
                  loading={loading}
                  onClick={onRefresh}
                  aria-label="Refresh active sessions"
                >
                  <IconRefresh size={18} />
                </ActionIcon>
              </Tooltip>
            ) : null}

            <Tooltip label="Close overview (Esc)">
              <ActionIcon
                size="md"
                variant="subtle"
                color="gray"
                onClick={onClose}
                aria-label="Close overview"
              >
                <IconX size={20} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {/* Filter Input */}
        {activeSessions.length > 1 ? (
          <Box pt="md">
            <TextInput
              size="xs"
              placeholder="Filter by workspace, title, branch, model, or archetype..."
              leftSection={<IconSearch size={14} />}
              value={filterQuery}
              onChange={e => setFilterQuery(e.currentTarget.value)}
              rightSection={
                filterQuery ? (
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    onClick={() => setFilterQuery("")}
                    aria-label="Clear filter"
                  >
                    <IconX size={12} />
                  </ActionIcon>
                ) : null
              }
            />
          </Box>
        ) : null}
      </Box>

      {/* Main Grid Content */}
      <ScrollArea style={{ flex: 1 }} p="lg">
        {activeSessions.length === 0 ? (
          <Center py={80}>
            <Stack align="center" gap="md" maw={420}>
              <ThemeIcon size={64} radius="xl" variant="light" color="gray">
                <IconStack2 size={36} />
              </ThemeIcon>
              <Text size="md" fw={600} ta="center">
                No Active Sessions in Memory
              </Text>
              <Text size="sm" c="dimmed" ta="center">
                Sessions are held live while in use or within their 1-hour sleep window. Pick a workspace from
                the header or start a new session to begin.
              </Text>
              {onNewSession ? (
                <Button
                  size="xs"
                  color="cyan"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => {
                    onClose();
                    onNewSession(process.cwd());
                  }}
                >
                  Start New Session
                </Button>
              ) : null}
            </Stack>
          </Center>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="md">
            {filteredSessions.map(session => {
              const isStreaming = session.state === "streaming";
              const isError = session.state === "error";

              return (
                <Card
                  key={session.key}
                  shadow="sm"
                  radius="md"
                  p="md"
                  withBorder
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    borderColor: isStreaming
                      ? "var(--mantine-color-plum-6)"
                      : isError
                        ? "var(--mantine-color-red-6)"
                        : undefined,
                  }}
                >
                  <Stack gap="xs">
                    {/* Top Row: Workspace, Git Branch, Status Dot */}
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                        <Badge
                          size="xs"
                          variant="light"
                          color="cyan"
                          leftSection={<IconFolder size={11} />}
                          style={{ flexShrink: 0 }}
                        >
                          {session.workdir}
                        </Badge>
                        {session.gitBranch ? (
                          <Badge
                            size="xs"
                            variant="outline"
                            color="teal"
                            leftSection={<IconGitBranch size={11} />}
                            style={{ flexShrink: 0 }}
                          >
                            {session.gitBranch}
                          </Badge>
                        ) : null}
                      </Group>

                      {renderDotMarker(session.turnCompletedDot)}
                    </Group>

                    {/* Title & Key */}
                    <Box>
                      <Text fw={700} size="sm" lineClamp={1} title={session.title}>
                        {session.title}
                      </Text>
                      <Text size="xs" c="dimmed" truncate title={session.key}>
                        {session.key.slice(0, 8)} · {session.cwd}
                      </Text>
                    </Box>

                    {/* Metadata Badges: Model, Thinking, Archetype */}
                    <Group gap={4} wrap="wrap">
                      <Badge size="xs" color="cyan" variant="light" leftSection={<IconCpu size={10} />}>
                        {session.modelName} ({session.thinkingLevel})
                      </Badge>
                      <Badge size="xs" color="plum" variant="light" leftSection={<IconRobot size={10} />}>
                        {session.agentArchetype}
                      </Badge>
                    </Group>

                    {/* Metrics Group */}
                    <Stack gap={4} pt={4} style={{ borderTop: "1px solid var(--omega-line)" }}>
                      <Group justify="space-between" align="center">
                        <Group gap={4}>
                          <IconMessage size={13} color="var(--mantine-color-dimmed)" />
                          <Text size="xs" c="dimmed">
                            Messages
                          </Text>
                        </Group>
                        <Text size="xs" fw={500}>
                          {session.messageCount} ({session.assistantTurns} turns)
                        </Text>
                      </Group>

                      <Group justify="space-between" align="center">
                        <Group gap={4}>
                          <IconChecklist size={13} color="var(--mantine-color-dimmed)" />
                          <Text size="xs" c="dimmed">
                            Todos
                          </Text>
                        </Group>
                        <Text size="xs" fw={500}>
                          {session.totalTodos > 0
                            ? `${session.completedTodos}/${session.totalTodos} done`
                            : "No tasks"}
                        </Text>
                      </Group>

                      <Group justify="space-between" align="center">
                        <Group gap={4}>
                          <IconClock size={13} color="var(--mantine-color-dimmed)" />
                          <Text size="xs" c="dimmed">
                            Last Active
                          </Text>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {formatRelative(session.lastActivityAt)}
                        </Text>
                      </Group>
                    </Stack>

                    {/* Error message if present */}
                    {session.lastError ? (
                      <Text size="xs" c="red.4" lineClamp={2} style={{ wordBreak: "break-word" }}>
                        {session.lastError}
                      </Text>
                    ) : null}
                  </Stack>

                  {/* Card Footer Actions */}
                  <Group justify="space-between" align="center" pt="md" mt="xs">
                    <Button
                      size="xs"
                      color="cyan"
                      variant="filled"
                      rightSection={<IconArrowRight size={13} />}
                      onClick={() => {
                        onClose();
                        onSelectSession(session.cwd, session.key);
                      }}
                      style={{ flex: 1 }}
                    >
                      Open Session
                    </Button>

                    {onStopSession ? (
                      <Tooltip label="Release from memory">
                        <ActionIcon
                          size="md"
                          variant="subtle"
                          color="red"
                          onClick={() => onStopSession(session.key)}
                          aria-label={`Release session ${session.key}`}
                        >
                          <IconPlayerStopFilled size={14} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                  </Group>
                </Card>
              );
            })}
          </SimpleGrid>
        )}
      </ScrollArea>
    </Modal>
  );
}
