import React, { useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconLayout2,
  IconPlayerStopFilled,
  IconPlus,
  IconRobot,
  IconSearch,
  IconSend,
  IconX,
} from "@tabler/icons-react";
/**
 * The sub-agents panel: lists active and settled sub-agents spawned during the session,
 * and provides interactive dispatch controls, filtering, status tracking, and Agents Hub access.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { SubagentStatus, SubagentTask } from "../api/model.ts";

export interface SubagentPanelProps {
  subagents: SubagentTask[];
  onClose?: () => void;
  onDispatchAgent?: (agent: string, task: string, context?: string) => Promise<void>;
  onCancelSubagent?: (id: string) => Promise<void>;
  onShowAgentsHub?: () => void;
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
      return { label: "running", color: "plum", pulsing: true };
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
  if (diffSec < 60) {
    return `${diffSec}s`;
  }
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${min}m ${sec}s`;
}

export function SubagentPanel({
  subagents,
  onClose,
  onDispatchAgent,
  onCancelSubagent,
  onShowAgentsHub,
}: SubagentPanelProps): React.ReactNode {
  const runningCount = subagents.filter((s) => s.status === "running").length;

  const [showDispatch, setShowDispatch] = useState(false);
  const [selectedRole, setSelectedRole] = useState("scout");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskContext, setTaskContext] = useState("");
  const [dispatching, setDispatching] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");

  const handleDispatchSubmit = async (e?: React.SyntheticEvent): Promise<void> => {
    e?.preventDefault();
    const task = taskPrompt.trim();
    if (!task || !onDispatchAgent) {
      return;
    }
    setDispatching(true);
    try {
      await onDispatchAgent(selectedRole, task, taskContext.trim() || undefined);
      notifications.show({
        color: "teal",
        title: `Dispatched ${selectedRole.toUpperCase()} agent`,
        message: `Task: "${task.slice(0, 60)}${task.length > 60 ? "…" : ""}"`,
      });
      setTaskPrompt("");
      setTaskContext("");
      setShowDispatch(false);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Dispatch failed",
        message: error instanceof Error ? error.message : "Failed to spawn subagent.",
      });
    } finally {
      setDispatching(false);
    }
  };

  const filteredSubagents = subagents.filter((s) => {
    if (!filterQuery.trim()) {
      return true;
    }
    const q = filterQuery.toLowerCase();
    return (
      s.id.toLowerCase().includes(q) ||
      s.agent.toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  });

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
            <Badge size="xs" variant="light" color={runningCount > 0 ? "plum" : "gray"}>
              {runningCount > 0 ? `${runningCount} active` : `${subagents.length} total`}
            </Badge>
          </Group>

          <Group gap={6} wrap="nowrap">
            {onShowAgentsHub ? (
              <Tooltip label="Open Agents Hub (/agents)">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="cyan"
                  onClick={onShowAgentsHub}
                  aria-label="Open Agents Hub"
                >
                  <IconLayout2 size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}

            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close sub-agents panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="md">
          {onDispatchAgent ? (
            <Group justify="space-between" align="center">
              <Text size="xs" fw={700} c="dimmed" tt="uppercase">
                Agent Workloads
              </Text>
              <Button
                size="xs"
                variant={showDispatch ? "subtle" : "light"}
                color="plum"
                leftSection={<IconPlus size={14} />}
                onClick={() => setShowDispatch((prev) => !prev)}
              >
                {showDispatch ? "Cancel" : "Dispatch Agent"}
              </Button>
            </Group>
          ) : null}

          <Collapse expanded={showDispatch}>
            <Card withBorder radius="md" p="sm" bg="dark.8">
              <form onSubmit={handleDispatchSubmit}>
                <Stack gap="xs">
                  <Text size="xs" fw={700} c="plum.4">
                    Dispatch Specialist Subagent
                  </Text>

                  <Box>
                    <Text size="xs" fw={500} mb={4}>
                      Role:
                    </Text>
                    <SegmentedControl
                      size="xs"
                      fullWidth
                      value={selectedRole}
                      onChange={setSelectedRole}
                      data={[
                        { label: "Scout", value: "scout" },
                        { label: "Task", value: "task" },
                        { label: "Reviewer", value: "reviewer" },
                        { label: "Security", value: "security-reviewer" },
                        { label: "Sonic", value: "sonic" },
                      ]}
                    />
                  </Box>

                  <TextInput
                    size="xs"
                    label="Task / Goal"
                    placeholder="e.g. Map all exports in src/server/router.ts and find callers"
                    value={taskPrompt}
                    onChange={(e) => setTaskPrompt(e.currentTarget.value)}
                    required
                    autoFocus
                  />

                  <Textarea
                    size="xs"
                    label="Context / Constraints (optional)"
                    placeholder="e.g. Skip formatters and linters. Focus on API boundaries."
                    value={taskContext}
                    onChange={(e) => setTaskContext(e.currentTarget.value)}
                    rows={2}
                  />

                  <Group justify="flex-end" pt="xs">
                    <Button
                      size="xs"
                      color="plum"
                      loading={dispatching}
                      disabled={!taskPrompt.trim()}
                      leftSection={<IconSend size={14} />}
                      onClick={() => handleDispatchSubmit()}
                    >
                      Dispatch {selectedRole.toUpperCase()}
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Card>
          </Collapse>

          {subagents.length > 2 ? (
            <TextInput
              size="xs"
              placeholder="Filter subagents by id, role, or task..."
              leftSection={<IconSearch size={14} />}
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.currentTarget.value)}
              rightSection={
                filterQuery ? (
                  <ActionIcon size="xs" variant="subtle" onClick={() => setFilterQuery("")} aria-label="Clear filter">
                    <IconX size={12} />
                  </ActionIcon>
                ) : null
              }
            />
          ) : null}

          {subagents.length === 0 ? (
            <Stack align="center" justify="center" py="xl" gap="xs">
              <IconRobot size={32} color="var(--mantine-color-dark-3)" />
              <Text size="sm" c="dimmed" ta="center">
                No sub-agents have been spawned in this session yet.
              </Text>
              {onDispatchAgent && !showDispatch ? (
                <Button
                  size="xs"
                  variant="light"
                  color="plum"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setShowDispatch(true)}
                >
                  Dispatch Subagent
                </Button>
              ) : null}
            </Stack>
          ) : (
            <Stack gap="sm">
              {filteredSubagents.map((task) => {
                const badge = statusBadge(task.status);
                const color = agentColor(task.agent);
                const duration = formatDuration(task.startedAt, task.completedAt);
                const isRunning = task.status === "running";

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

                          {isRunning && onCancelSubagent ? (
                            <Tooltip label="Cancel subagent">
                              <ActionIcon
                                size="xs"
                                variant="subtle"
                                color="red"
                                onClick={() => onCancelSubagent(task.id)}
                                aria-label={`Cancel ${task.id}`}
                              >
                                <IconPlayerStopFilled size={12} />
                              </ActionIcon>
                            </Tooltip>
                          ) : null}
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
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
