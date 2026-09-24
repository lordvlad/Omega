import React, { useState } from "react";
import {
  IconAlertOctagon,
  IconCheck,
  IconChecklist,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleX,
  IconCopy,
  IconDotsVertical,
  IconPlayerPlayFilled,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
/**
 * The Todo Panel.
 *
 * Renders and manages the session's phases and tasks tracked by omp's `todo` tool.
 * Provides rich interactive capabilities: toggling task status, appending tasks
 * to phases, deleting tasks/phases, copying as Markdown, and clearing tasks.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Collapse,
  Group,
  Menu,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import type { MutateTodosRequest, TodoPhase, TodoTask, TodoTaskStatus } from "../api/model.ts";

export interface TodoPanelProps {
  phases: TodoPhase[] | undefined;
  onClose?: () => void;
  onMutateTodos?: (req: MutateTodosRequest) => Promise<void>;
}

const STATUS_ICONS: Record<TodoTaskStatus, { icon: typeof IconCircle; color: string; label: string }> = {
  completed: { icon: IconCircleCheckFilled, color: "cyan", label: "Completed" },
  in_progress: { icon: IconPlayerPlayFilled, color: "plum", label: "In Progress" },
  pending: { icon: IconCircle, color: "gray", label: "Pending" },
  blocked: { icon: IconAlertOctagon, color: "orange", label: "Blocked" },
  abandoned: { icon: IconCircleX, color: "gray", label: "Abandoned" },
};

/** Next status in the single-click cycle: pending -> in_progress -> completed -> pending. */
function nextCycleStatus(status: TodoTaskStatus): TodoTaskStatus {
  switch (status) {
    case "pending":
      return "in_progress";
    case "in_progress":
      return "completed";
    case "completed":
      return "pending";
    case "blocked":
    case "abandoned":
      return "pending";
  }
}

/** Format todo phases into clean GitHub-flavored Markdown checklist. */
function phasesToMarkdown(phases: readonly TodoPhase[]): string {
  const lines: string[] = [];
  for (const phase of phases) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(`### ${phase.name}`);
    for (const task of phase.tasks) {
      const isDone = task.status === "completed";
      const isAbandoned = task.status === "abandoned";
      const marker = isDone ? "[x]" : isAbandoned ? "[-]" : "[ ]";
      let line = `- ${marker} ${task.content}`;
      if (task.status === "in_progress") {
        line += " *(in progress)*";
      }
      if (task.status === "blocked" && task.blocker) {
        line += ` *(blocked: ${task.blocker})*`;
      }
      lines.push(line);
    }
  }
  return lines.join("\n");
}

interface TaskItemProps {
  task: TodoTask;
  phaseName: string;
  onMutate?: (req: MutateTodosRequest) => Promise<void>;
}

function TaskItem({ task, phaseName: _phaseName, onMutate }: TaskItemProps) {
  const meta = STATUS_ICONS[task.status] ?? STATUS_ICONS.pending;
  const IconComponent = meta.icon;
  const isDone = task.status === "completed";
  const isInProgress = task.status === "in_progress";
  const isAbandoned = task.status === "abandoned";
  const isBlocked = task.status === "blocked";

  const [editingBlocker, setEditingBlocker] = useState(false);
  const [blockerText, setBlockerText] = useState(task.blocker ?? "");

  const handleCycleStatus = async (): Promise<void> => {
    if (!onMutate) {
      return;
    }
    const next = nextCycleStatus(task.status);
    await onMutate({
      action: "set",
      task: task.content,
      status: next,
    });
  };

  const handleSetExactStatus = async (status: TodoTaskStatus): Promise<void> => {
    if (!onMutate) {
      return;
    }
    if (status === "blocked") {
      setEditingBlocker(true);
      return;
    }
    await onMutate({
      action: "set",
      task: task.content,
      status,
      blocker: undefined,
    });
  };

  const handleSaveBlocker = async (): Promise<void> => {
    if (!onMutate) {
      return;
    }
    setEditingBlocker(false);
    await onMutate({
      action: "block",
      task: task.content,
      blocker: blockerText.trim() || "Blocked",
    });
  };

  const handleDeleteTask = async (): Promise<void> => {
    if (!onMutate) {
      return;
    }
    await onMutate({
      action: "rm",
      task: task.content,
    });
  };

  return (
    <Box
      py={4}
      px={6}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        background: isInProgress ? "color-mix(in srgb, var(--mantine-color-plum-9) 30%, transparent)" : undefined,
      }}
    >
      <Group gap={6} align="flex-start" wrap="nowrap" justify="space-between">
        <Group gap={8} align="flex-start" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
          <Tooltip label={`${meta.label} · click to cycle`}>
            <UnstyledButton
              onClick={handleCycleStatus}
              aria-label={`Cycle status for "${task.content}" (currently ${meta.label})`}
              style={{ display: "inline-flex", marginTop: 2, flexShrink: 0 }}
            >
              <ThemeIcon
                size={18}
                radius="xl"
                color={meta.color}
                variant={isDone || isInProgress ? "filled" : isBlocked ? "light" : "subtle"}
              >
                <IconComponent size={12} />
              </ThemeIcon>
            </UnstyledButton>
          </Tooltip>

          <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
            <Text
              size="sm"
              style={{
                textDecoration: isDone || isAbandoned ? "line-through" : undefined,
                opacity: isDone || isAbandoned ? 0.6 : 1,
                fontWeight: isInProgress ? 600 : 400,
                wordBreak: "break-word",
              }}
            >
              {task.content}
            </Text>

            {task.blocker && !editingBlocker ? (
              <Text size="xs" c="orange.4" style={{ fontStyle: "italic" }}>
                Waiting on: {task.blocker}
              </Text>
            ) : null}

            {editingBlocker ? (
              <Group gap={4} pt={2}>
                <TextInput
                  size="xs"
                  placeholder="Reason / blocker..."
                  value={blockerText}
                  onChange={(e) => setBlockerText(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveBlocker()}
                  style={{ flex: 1 }}
                  autoFocus
                />
                <Button size="compact-xs" color="orange" onClick={handleSaveBlocker}>
                  Block
                </Button>
                <ActionIcon size="xs" variant="subtle" onClick={() => setEditingBlocker(false)}>
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            ) : null}
          </Stack>
        </Group>

        {onMutate ? (
          <Menu position="bottom-end" shadow="md" width={170} withinPortal>
            <Menu.Target>
              <ActionIcon size="xs" variant="subtle" color="gray" aria-label="Task options">
                <IconDotsVertical size={12} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Set Status</Menu.Label>
              <Menu.Item
                leftSection={<IconCircleCheckFilled size={14} color="var(--mantine-color-cyan-4)" />}
                onClick={() => handleSetExactStatus("completed")}
              >
                Completed
              </Menu.Item>
              <Menu.Item
                leftSection={<IconPlayerPlayFilled size={14} color="var(--mantine-color-plum-4)" />}
                onClick={() => handleSetExactStatus("in_progress")}
              >
                In Progress
              </Menu.Item>
              <Menu.Item
                leftSection={<IconCircle size={14} color="var(--mantine-color-gray-5)" />}
                onClick={() => handleSetExactStatus("pending")}
              >
                Pending
              </Menu.Item>
              <Menu.Item
                leftSection={<IconAlertOctagon size={14} color="var(--mantine-color-orange-4)" />}
                onClick={() => handleSetExactStatus("blocked")}
              >
                Blocked...
              </Menu.Item>
              <Menu.Item
                leftSection={<IconCircleX size={14} color="var(--mantine-color-gray-5)" />}
                onClick={() => handleSetExactStatus("abandoned")}
              >
                Abandon
              </Menu.Item>

              <Menu.Divider />
              <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={handleDeleteTask}>
                Delete Task
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : null}
      </Group>
    </Box>
  );
}

export function TodoPanel({ phases, onClose, onMutateTodos }: TodoPanelProps) {
  const allTasks = (phases ?? []).flatMap((p) => p.tasks);
  const total = allTasks.length;
  const completed = allTasks.filter((t) => t.status === "completed").length;
  const inProgress = allTasks.filter((t) => t.status === "in_progress").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  const [addingToPhase, setAddingToPhase] = useState<string | null>(null);
  const [newTaskContent, setNewTaskContent] = useState("");
  const [showAddPhase, setShowAddPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");

  const handleCopyMarkdown = async (): Promise<void> => {
    if (!phases || phases.length === 0) {
      return;
    }
    const md = phasesToMarkdown(phases);
    try {
      await navigator.clipboard.writeText(md);
      notifications.show({
        color: "cyan",
        title: "Todos copied to clipboard",
        message: `${total} tasks copied as Markdown checklist.`,
      });
    } catch {
      notifications.show({
        color: "red",
        title: "Copy failed",
        message: "Clipboard write was blocked by the browser.",
      });
    }
  };

  const handleAddSubmit = async (phaseName: string): Promise<void> => {
    const text = newTaskContent.trim();
    if (!text || !onMutateTodos) {
      return;
    }
    await onMutateTodos({
      action: "append",
      phase: phaseName,
      task: text,
    });
    setNewTaskContent("");
    setAddingToPhase(null);
  };

  const handleCreatePhaseSubmit = async (): Promise<void> => {
    const pName = newPhaseName.trim();
    const tContent = newTaskContent.trim();
    if (!pName || !onMutateTodos) {
      return;
    }
    await onMutateTodos({
      action: "append",
      phase: pName,
      task: tContent || "Initial task",
    });
    setNewPhaseName("");
    setNewTaskContent("");
    setShowAddPhase(false);
  };

  const handleMarkAllDone = async (): Promise<void> => {
    if (!onMutateTodos) {
      return;
    }
    await onMutateTodos({ action: "done" });
    notifications.show({
      color: "cyan",
      title: "All tasks completed",
      message: `Marked all ${total} tasks as completed.`,
    });
  };

  const handleClearCompleted = async (): Promise<void> => {
    if (!onMutateTodos) {
      return;
    }
    await onMutateTodos({ action: "clear", status: "completed" });
    notifications.show({
      color: "plum",
      title: "Cleared completed tasks",
      message: `Removed ${completed} completed tasks.`,
    });
  };

  const handleClearAll = async (): Promise<void> => {
    if (!onMutateTodos) {
      return;
    }
    await onMutateTodos({ action: "clear" });
    notifications.show({
      color: "plum",
      title: "Cleared all todos",
      message: "Removed all phases and tasks.",
    });
  };

  const handleDeletePhase = async (phaseName: string): Promise<void> => {
    if (!onMutateTodos) {
      return;
    }
    await onMutateTodos({ action: "rm", phase: phaseName });
  };

  return (
    <Stack gap={0} h="100%">
      <Paper p="sm" withBorder radius={0} style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <IconChecklist size={18} color="var(--mantine-color-cyan-4)" />
            <Text size="sm" fw={700}>
              Todos
            </Text>
            {total > 0 ? (
              <Badge size="sm" variant="light" color={percent === 100 ? "cyan" : inProgress > 0 ? "plum" : "gray"}>
                {completed}/{total}
              </Badge>
            ) : null}
          </Group>

          <Group gap={4} wrap="nowrap">
            {total > 0 ? (
              <Tooltip label="Copy as Markdown">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="cyan"
                  onClick={handleCopyMarkdown}
                  aria-label="Copy todos as Markdown"
                >
                  <IconCopy size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}

            {onMutateTodos ? (
              <Menu position="bottom-end" shadow="md" width={180} withinPortal>
                <Menu.Target>
                  <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Todo options">
                    <IconDotsVertical size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconPlus size={14} />} onClick={() => setShowAddPhase(true)}>
                    Add Phase...
                  </Menu.Item>
                  {total > 0 ? (
                    <>
                      <Menu.Item
                        leftSection={<IconCheck size={14} color="var(--mantine-color-cyan-4)" />}
                        onClick={handleMarkAllDone}
                      >
                        Mark All Done
                      </Menu.Item>
                      {completed > 0 ? (
                        <Menu.Item leftSection={<IconTrash size={14} />} onClick={handleClearCompleted}>
                          Clear Completed ({completed})
                        </Menu.Item>
                      ) : null}
                      <Menu.Divider />
                      <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={handleClearAll}>
                        Clear All Todos
                      </Menu.Item>
                    </>
                  ) : null}
                </Menu.Dropdown>
              </Menu>
            ) : null}

            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close todos panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>

        {total > 0 ? (
          <Box pt="xs">
            <Progress value={percent} size="xs" color="cyan" radius="xl" animated={inProgress > 0} />
          </Box>
        ) : null}
      </Paper>

      <ScrollArea style={{ flex: 1 }} p="sm" type="auto">
        <Stack gap="md">
          <Collapse expanded={showAddPhase}>
            <Card withBorder radius="md" p="sm" bg="dark.8">
              <Stack gap="xs">
                <Text size="xs" fw={700} c="cyan.4">
                  New Todo Phase
                </Text>
                <TextInput
                  size="xs"
                  label="Phase Name"
                  placeholder="e.g. Foundation, Verification, Cleanup"
                  value={newPhaseName}
                  onChange={(e) => setNewPhaseName(e.currentTarget.value)}
                  autoFocus
                />
                <TextInput
                  size="xs"
                  label="First Task (optional)"
                  placeholder="e.g. Scaffolding, run tests"
                  value={newTaskContent}
                  onChange={(e) => setNewTaskContent(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreatePhaseSubmit()}
                />
                <Group justify="flex-end" pt="xs">
                  <Button size="xs" variant="subtle" color="gray" onClick={() => setShowAddPhase(false)}>
                    Cancel
                  </Button>
                  <Button size="xs" color="cyan" disabled={!newPhaseName.trim()} onClick={handleCreatePhaseSubmit}>
                    Create Phase
                  </Button>
                </Group>
              </Stack>
            </Card>
          </Collapse>

          {!phases || phases.length === 0 || total === 0 ? (
            <Stack align="center" justify="center" py="xl" gap="sm">
              <ThemeIcon size={40} radius="xl" variant="light" color="gray">
                <IconChecklist size={24} />
              </ThemeIcon>
              <Text size="sm" c="dimmed" ta="center" px="md">
                No tasks tracked yet. Multi-step work planned by the agent will appear here.
              </Text>
              {onMutateTodos && !showAddPhase ? (
                <Button
                  size="xs"
                  variant="light"
                  color="cyan"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setShowAddPhase(true)}
                >
                  Add Tasks
                </Button>
              ) : null}
            </Stack>
          ) : (
            phases.map((phase) => {
              const phaseTasks = phase.tasks;
              const phaseDone = phaseTasks.filter((t) => t.status === "completed").length;
              const isAddingHere = addingToPhase === phase.name;

              return (
                <Card key={phase.name} padding="xs" radius="sm" withBorder>
                  <Group justify="space-between" mb={6} wrap="nowrap">
                    <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                      <Text size="xs" fw={700} tt="uppercase" c="dimmed" truncate>
                        {phase.name}
                      </Text>
                      <Badge
                        size="xs"
                        variant="outline"
                        color={phaseDone === phaseTasks.length && phaseTasks.length > 0 ? "teal" : "gray"}
                      >
                        {phaseDone}/{phaseTasks.length}
                      </Badge>
                    </Group>

                    {onMutateTodos ? (
                      <Group gap={4} wrap="nowrap">
                        <Tooltip label={`Add task to ${phase.name}`}>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="cyan"
                            onClick={() => setAddingToPhase((prev) => (prev === phase.name ? null : phase.name))}
                            aria-label={`Add task to ${phase.name}`}
                          >
                            <IconPlus size={14} />
                          </ActionIcon>
                        </Tooltip>

                        <Tooltip label={`Delete phase "${phase.name}"`}>
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="red"
                            onClick={() => handleDeletePhase(phase.name)}
                            aria-label={`Delete phase ${phase.name}`}
                          >
                            <IconTrash size={12} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    ) : null}
                  </Group>

                  <Stack gap={2}>
                    {phaseTasks.map((task, idx) => (
                      <TaskItem
                        key={`${phase.name}-${idx}-${task.content}`}
                        task={task}
                        phaseName={phase.name}
                        onMutate={onMutateTodos}
                      />
                    ))}

                    <Collapse expanded={isAddingHere}>
                      <Box pt={4}>
                        <Group gap={4} wrap="nowrap">
                          <TextInput
                            size="xs"
                            placeholder="New task content (Enter to save)..."
                            value={newTaskContent}
                            onChange={(e) => setNewTaskContent(e.currentTarget.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddSubmit(phase.name)}
                            style={{ flex: 1 }}
                            autoFocus
                          />
                          <Button
                            size="compact-xs"
                            color="cyan"
                            disabled={!newTaskContent.trim()}
                            onClick={() => handleAddSubmit(phase.name)}
                          >
                            Add
                          </Button>
                          <ActionIcon size="xs" variant="subtle" onClick={() => setAddingToPhase(null)}>
                            <IconX size={12} />
                          </ActionIcon>
                        </Group>
                      </Box>
                    </Collapse>
                  </Stack>
                </Card>
              );
            })
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
