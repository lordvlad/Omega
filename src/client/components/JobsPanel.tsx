/**
 * Jobs panel: inspect and cancel async background jobs (subagents, bash, workers).
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconPlayerStop,
  IconRefresh,
  IconStack2,
  IconX,
} from "@tabler/icons-react";
import React, { useState } from "react";

import type { CancelJobRequest, SessionAsyncJob } from "../api/model.ts";

export interface JobsPanelProps {
  running: SessionAsyncJob[];
  recent: SessionAsyncJob[];
  loading?: boolean;
  onCancelJob: (req: CancelJobRequest) => Promise<void>;
  onRefresh?: () => void;
  onClose?: () => void;
}

function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return `${min}m ${rem}s`;
}

function jobTypeColor(type: string): string {
  switch (type.toLowerCase()) {
    case "task":
      return "cyan";
    case "bash":
      return "plum";
    case "eval":
      return "yellow";
    case "debug":
      return "orange";
    default:
      return "teal";
  }
}

export function JobsPanel({
  running,
  recent,
  loading = false,
  onCancelJob,
  onRefresh,
  onClose,
}: JobsPanelProps): React.ReactNode {
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleCancel = async (job: SessionAsyncJob): Promise<void> => {
    setCancellingId(job.id);
    try {
      await onCancelJob({ id: job.id });
      notifications.show({
        color: "plum",
        title: "Job cancelled",
        message: `Cancelled job "${job.id}".`,
      });
      onRefresh?.();
    } finally {
      setCancellingId(null);
    }
  };

  const total = running.length + recent.length;

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="cyan">
              <IconStack2 size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              Background Jobs (/jobs)
            </Text>
            <Badge size="xs" variant="light" color={running.length > 0 ? "cyan" : "gray"}>
              {running.length > 0 ? `${running.length} running` : `${total} total`}
            </Badge>
          </Group>
          <Group gap={6} wrap="nowrap">
            {onRefresh ? (
              <ActionIcon size="sm" variant="subtle" onClick={onRefresh} aria-label="Refresh jobs">
                <IconRefresh size={16} />
              </ActionIcon>
            ) : null}
            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close jobs panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="lg">
          {/* Running Jobs Section */}
          <Box>
            <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">
              Active Jobs ({running.length})
            </Text>

            {running.length === 0 ? (
              <Card withBorder radius="md" p="sm" bg="dark.8">
                <Text size="xs" c="dimmed" ta="center">
                  No background jobs currently running.
                </Text>
              </Card>
            ) : (
              <Stack gap="sm">
                {running.map(job => (
                  <Card key={job.id} withBorder radius="md" p="sm" shadow="xs">
                    <Stack gap="xs">
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <Group gap={6} wrap="nowrap">
                          <Badge size="xs" color={jobTypeColor(job.type)} variant="filled">
                            {job.type}
                          </Badge>
                          <Text size="xs" fw={700} style={{ fontFamily: "monospace" }}>
                            {job.id}
                          </Text>
                          <Badge size="xs" color="cyan" variant="light" className="omega-pulse">
                            running
                          </Badge>
                        </Group>

                        <Button
                          size="compact-xs"
                          variant="light"
                          color="red"
                          loading={cancellingId === job.id}
                          leftSection={<IconPlayerStop size={12} />}
                          onClick={() => handleCancel(job)}
                        >
                          Cancel
                        </Button>
                      </Group>

                      {job.label ? (
                        <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                          {job.label}
                        </Text>
                      ) : null}

                      <Group gap={4} wrap="nowrap">
                        <IconClock size={12} color="var(--mantine-color-dimmed)" />
                        <Text size="xs" c="dimmed">
                          Started {formatDuration(Date.now() - job.startTime)} ago
                        </Text>
                      </Group>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Box>

          {/* Recent Jobs Section */}
          {recent.length > 0 ? (
            <Box>
              <Text size="xs" fw={700} c="dimmed" mb="xs" tt="uppercase">
                Recent Jobs ({recent.length})
              </Text>
              <Stack gap="sm">
                {recent.map(job => {
                  const isCompleted = job.status === "completed" || job.status === "done";
                  const isFailed = job.status === "failed" || job.status === "error";

                  return (
                    <Card key={job.id} withBorder radius="md" p="sm" bg="dark.8">
                      <Stack gap="xs">
                        <Group justify="space-between" align="center" wrap="nowrap">
                          <Group gap={6} wrap="nowrap">
                            <Badge size="xs" color={jobTypeColor(job.type)} variant="light">
                              {job.type}
                            </Badge>
                            <Text size="xs" fw={600} style={{ fontFamily: "monospace" }}>
                              {job.id}
                            </Text>
                            <Badge
                              size="xs"
                              color={isCompleted ? "teal" : isFailed ? "red" : "gray"}
                              variant="outline"
                              leftSection={
                                isCompleted ? (
                                  <IconCheck size={10} />
                                ) : isFailed ? (
                                  <IconAlertTriangle size={10} />
                                ) : undefined
                              }
                            >
                              {job.status}
                            </Badge>
                          </Group>

                          <Text size="xs" c="dimmed">
                            {formatDuration(job.durationMs)}
                          </Text>
                        </Group>

                        {job.label ? (
                          <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                            {job.label}
                          </Text>
                        ) : null}

                        {job.error ? (
                          <Text size="xs" c="red.4">
                            {job.error}
                          </Text>
                        ) : null}
                      </Stack>
                    </Card>
                  );
                })}
              </Stack>
            </Box>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
