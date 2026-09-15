/**
 * The sub-agents panel: lists active and settled sub-agents spawned during the session.
 */
import { ActionIcon, Badge, Box, Card, Group, ScrollArea, Stack, Text, ThemeIcon } from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconClock, IconRobot, IconX } from "@tabler/icons-react";
import React from "react";

import type { SubagentStatus, SubagentTask } from "../api/model.ts";

export interface SubagentPanelProps {
  subagents: SubagentTask[];
  onClose?: () => void;
}

/** Color for agent roles. */
function agentColor(agent: string): string {
  switch (agent.toLowerCase()) {
    case "scout":
      return "cyan";
    case "reviewer":
      return "plum";
    case "sonic":
      return "yellow";
    case "security-reviewer":
      return "red";
    case "task":
    default:
      return "teal";
  }
}

/** Status badge configuration. */
function statusBadge(status: SubagentStatus): { label: string; color: string; pulsing?: boolean } {
  switch (status) {
    case "running":
      return { label: "running", color: "cyan", pulsing: true };
    case "completed":
      return { label: "completed", color: "teal" };
    case "failed":
      return { label: "failed", color: "red" };
    case "aborted":
      return { label: "aborted", color: "gray" };
    default:
      return { label: status, color: "gray" };
  }
}

/** Format elapsed duration between two timestamps. */
function formatDuration(startedAt: number, completedAt?: number): string {
  const end = completedAt ?? Date.now();
  const diffSec = Math.max(0, Math.round((end - startedAt) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

export function SubagentPanel({ subagents, onClose }: SubagentPanelProps): React.ReactNode {
  const runningCount = subagents.filter(s => s.status === "running").length;

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="plum">
              <IconRobot size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              Sub-Agents
            </Text>
            <Badge size="xs" variant="light" color={runningCount > 0 ? "cyan" : "gray"}>
              {runningCount > 0 ? `${runningCount} active` : `${subagents.length} total`}
            </Badge>
          </Group>
          {onClose ? (
            <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close sub-agents panel">
              <IconX size={16} />
            </ActionIcon>
          ) : null}
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        {subagents.length === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="xs">
            <IconRobot size={32} color="var(--mantine-color-dark-3)" />
            <Text size="sm" c="dimmed" ta="center">
              No sub-agents have been spawned in this session yet.
            </Text>
          </Stack>
        ) : (
          <Stack gap="sm">
            {subagents.map(task => {
              const badge = statusBadge(task.status);
              const color = agentColor(task.agent);
              const duration = formatDuration(task.startedAt, task.completedAt);

              return (
                <Card key={task.id} withBorder radius="md" p="sm" shadow="xs">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" color={color} variant="filled">
                          {task.agent}
                        </Badge>
                        <Text size="xs" fw={600} truncate style={{ maxWidth: 160 }}>
                          {task.id}
                        </Text>
                      </Group>
                      <Group gap={6} wrap="nowrap">
                        <Badge
                          size="xs"
                          color={badge.color}
                          variant="light"
                          className={badge.pulsing ? "omega-pulse" : undefined}
                          leftSection={
                            task.status === "completed" ? (
                              <IconCheck size={10} />
                            ) : task.status === "failed" ? (
                              <IconAlertTriangle size={10} />
                            ) : undefined
                          }
                        >
                          {badge.label}
                        </Badge>
                        <Group gap={2} wrap="nowrap">
                          <IconClock size={11} color="var(--mantine-color-dimmed)" />
                          <Text size="xs" c="dimmed">
                            {duration}
                          </Text>
                        </Group>
                      </Group>
                    </Group>

                    {task.description ? (
                      <Text size="xs" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                        {task.description}
                      </Text>
                    ) : null}

                    {task.error ? (
                      <Text size="xs" c="red.4">
                        {task.error}
                      </Text>
                    ) : null}
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
