/**
 * Process panel: manage and supervise project background daemons and services (/ps).
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBolt,
  IconDotsVertical,
  IconPlayerStop,
  IconRefresh,
  IconTerminal2,
  IconX,
} from "@tabler/icons-react";
import React, { useState } from "react";

import type {
  ManagedProcessInfo,
  ProcessActionRequest,
  ProcessLifecycleState,
  ProcessSignal,
  SignalProcessRequest,
} from "../api/model.ts";

export interface ProcessPanelProps {
  processes: ManagedProcessInfo[];
  loading?: boolean;
  onSignalProcess: (req: SignalProcessRequest) => Promise<void>;
  onStopProcess: (req: ProcessActionRequest) => Promise<void>;
  onRestartProcess: (req: ProcessActionRequest) => Promise<void>;
  onRefresh?: () => void;
  onClose?: () => void;
}

function processStateColor(state: ProcessLifecycleState): string {
  switch (state) {
    case "running":
    case "ready":
      return "teal";
    case "starting":
      return "yellow";
    case "idle":
      return "plum";
    case "exited":
    case "stopped":
    default:
      return "gray";
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatUptime(startedAt?: number, exitedAt?: number): string {
  if (!startedAt) return "";
  const end = exitedAt ?? Date.now();
  const diffSec = Math.max(0, Math.round((end - startedAt) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m`;
}

export function ProcessPanel({
  processes,
  loading = false,
  onSignalProcess,
  onStopProcess,
  onRestartProcess,
  onRefresh,
  onClose,
}: ProcessPanelProps): React.ReactNode {
  const [busyName, setBusyName] = useState<string | null>(null);

  const handleSignal = async (name: string, signal: ProcessSignal): Promise<void> => {
    setBusyName(name);
    try {
      await onSignalProcess({ name, signal });
      notifications.show({
        color: "cyan",
        title: "Signal sent",
        message: `Sent ${signal} to process "${name}".`,
      });
      onRefresh?.();
    } finally {
      setBusyName(null);
    }
  };

  const handleStop = async (name: string): Promise<void> => {
    setBusyName(name);
    try {
      await onStopProcess({ name });
      notifications.show({
        color: "plum",
        title: "Process stopped",
        message: `Stopped process "${name}".`,
      });
      onRefresh?.();
    } finally {
      setBusyName(null);
    }
  };

  const handleRestart = async (name: string): Promise<void> => {
    setBusyName(name);
    try {
      await onRestartProcess({ name });
      notifications.show({
        color: "cyan",
        title: "Process restarted",
        message: `Restarted process "${name}".`,
      });
      onRefresh?.();
    } finally {
      setBusyName(null);
    }
  };

  const runningCount = processes.filter(p => p.state === "running" || p.state === "ready").length;

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="cyan">
              <IconTerminal2 size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              Supervised Processes (/ps)
            </Text>
            <Badge size="xs" variant="light" color={runningCount > 0 ? "teal" : "gray"}>
              {runningCount > 0 ? `${runningCount} running` : `${processes.length} total`}
            </Badge>
          </Group>
          <Group gap={6} wrap="nowrap">
            {onRefresh ? (
              <ActionIcon size="sm" variant="subtle" onClick={onRefresh} aria-label="Refresh processes">
                <IconRefresh size={16} />
              </ActionIcon>
            ) : null}
            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close process panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        {loading ? (
          <Stack align="center" justify="center" py="xl">
            <Loader size="sm" color="cyan" />
          </Stack>
        ) : processes.length === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="xs">
            <IconTerminal2 size={32} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              No supervised processes active.
            </Text>
            <Text size="xs" c="dimmed" ta="center">
              Long-running services, watchers, and servers started via hub(op:"start") appear here.
            </Text>
          </Stack>
        ) : (
          <Stack gap="sm">
            {processes.map(proc => {
              const isBusy = busyName === proc.name;
              const isRunning = proc.state === "running" || proc.state === "ready";
              const uptime = formatUptime(proc.startedAt, proc.exitedAt);

              return (
                <Card key={proc.name} withBorder radius="md" p="sm" shadow="xs">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" fw={700} style={{ fontFamily: "monospace" }}>
                          {proc.name}
                        </Text>
                        <Badge
                          size="xs"
                          color={processStateColor(proc.state)}
                          variant={isRunning ? "filled" : "outline"}
                        >
                          {proc.state}
                        </Badge>
                        {proc.pid ? (
                          <Badge size="xs" variant="light" color="gray">
                            PID {proc.pid}
                          </Badge>
                        ) : null}
                      </Group>

                      <Group gap={6} wrap="nowrap">
                        {isRunning ? (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="red"
                            loading={isBusy}
                            leftSection={<IconPlayerStop size={12} />}
                            onClick={() => handleStop(proc.name)}
                          >
                            Stop
                          </Button>
                        ) : (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="cyan"
                            loading={isBusy}
                            leftSection={<IconRefresh size={12} />}
                            onClick={() => handleRestart(proc.name)}
                          >
                            Restart
                          </Button>
                        )}

                        <Menu position="bottom-end" withinPortal shadow="md">
                          <Menu.Target>
                            <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Process actions">
                              <IconDotsVertical size={14} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Label>Signals</Menu.Label>
                            <Menu.Item
                              leftSection={<IconBolt size={14} color="var(--mantine-color-yellow-4)" />}
                              onClick={() => handleSignal(proc.name, "SIGINT")}
                            >
                              Send SIGINT (Ctrl+C)
                            </Menu.Item>
                            <Menu.Item
                              leftSection={<IconPlayerStop size={14} color="var(--mantine-color-orange-4)" />}
                              onClick={() => handleSignal(proc.name, "SIGTERM")}
                            >
                              Send SIGTERM
                            </Menu.Item>
                            <Menu.Item
                              color="red"
                              leftSection={<IconX size={14} />}
                              onClick={() => handleSignal(proc.name, "SIGKILL")}
                            >
                              Send SIGKILL (Force)
                            </Menu.Item>
                            <Menu.Divider />
                            <Menu.Item
                              leftSection={<IconRefresh size={14} />}
                              onClick={() => handleRestart(proc.name)}
                            >
                              Restart Process
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      </Group>
                    </Group>

                    {proc.application ? (
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          Command:
                        </Text>
                        <Code style={{ fontSize: "11px" }}>
                          {[proc.application, ...(proc.args ?? [])].join(" ")}
                        </Code>
                      </Group>
                    ) : null}

                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        {uptime ? (
                          <Text size="xs" c="dimmed">
                            {isRunning ? `Uptime: ${uptime}` : `Ran for: ${uptime}`}
                          </Text>
                        ) : null}
                        {proc.restartCount > 0 ? (
                          <Badge size="xs" variant="light" color="yellow">
                            {proc.restartCount} restarts
                          </Badge>
                        ) : null}
                      </Group>

                      {proc.outputBytes > 0 ? (
                        <Text size="xs" c="dimmed">
                          {formatBytes(proc.outputBytes)} output
                        </Text>
                      ) : null}
                    </Group>
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
}
