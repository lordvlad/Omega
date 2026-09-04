/**
 * The Todo Panel.
 *
 * Renders the session's phases and tasks tracked by omp's `todo` tool.
 * Hosted in `AppShell.aside` on desktop and in a slide-out drawer on mobile,
 * toggled via the checklist button in the top menu bar.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Group,
  Paper,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertOctagon,
  IconChecklist,
  IconCircle,
  IconCircleCheckFilled,
  IconCircleX,
  IconPlayerPlayFilled,
  IconX,
} from "@tabler/icons-react";

import type { TodoPhase, TodoTask, TodoTaskStatus } from "../api/model.ts";

export interface TodoPanelProps {
  phases: TodoPhase[] | undefined;
  onClose?: () => void;
}

const STATUS_ICONS: Record<TodoTaskStatus, { icon: typeof IconCircle; color: string; label: string }> = {
  completed: { icon: IconCircleCheckFilled, color: "lagoon", label: "Completed" },
  in_progress: { icon: IconPlayerPlayFilled, color: "plum", label: "In Progress" },
  pending: { icon: IconCircle, color: "slate", label: "Pending" },
  blocked: { icon: IconAlertOctagon, color: "orange", label: "Blocked" },
  abandoned: { icon: IconCircleX, color: "slate", label: "Abandoned" },
};

function TaskItem({ task }: { task: TodoTask }) {
  const meta = STATUS_ICONS[task.status] ?? STATUS_ICONS.pending;
  const IconComponent = meta.icon;
  const isDone = task.status === "completed";
  const isInProgress = task.status === "in_progress";
  const isAbandoned = task.status === "abandoned";

  return (
    <Box
      py={6}
      px={8}
      style={{
        borderRadius: "var(--mantine-radius-sm)",
        background: isInProgress
          ? "color-mix(in srgb, var(--mantine-color-plum-9) 35%, transparent)"
          : undefined,
      }}
    >
      <Group gap={8} align="flex-start" wrap="nowrap">
        <Tooltip label={meta.label}>
          <ThemeIcon
            size={18}
            radius="xl"
            color={meta.color}
            variant={isDone || isInProgress ? "filled" : "subtle"}
            style={{ marginTop: 2, flexShrink: 0 }}
          >
            <IconComponent size={12} />
          </ThemeIcon>
        </Tooltip>

        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Text
            size="sm"
            style={{
              textDecoration: isDone || isAbandoned ? "line-through" : undefined,
              opacity: isDone || isAbandoned ? 0.6 : 1,
              fontWeight: isInProgress ? 600 : 400,
            }}
          >
            {task.content}
          </Text>

          {task.blocker ? (
            <Text size="xs" c="orange.4" style={{ fontStyle: "italic" }}>
              Waiting on: {task.blocker}
            </Text>
          ) : null}
        </Stack>
      </Group>
    </Box>
  );
}

export function TodoPanel({ phases, onClose }: TodoPanelProps) {
  const allTasks = (phases ?? []).flatMap(p => p.tasks);
  const total = allTasks.length;
  const completed = allTasks.filter(t => t.status === "completed").length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <Stack gap={0} h="100%">
      <Paper p="sm" withBorder radius={0} style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap={8} wrap="nowrap">
            <IconChecklist size={18} color="var(--mantine-color-lagoon-4)" />
            <Text size="sm" fw={700}>
              Todos
            </Text>
            {total > 0 ? (
              <Badge size="sm" variant="light" color={percent === 100 ? "lagoon" : "plum"}>
                {completed}/{total}
              </Badge>
            ) : null}
          </Group>

          {onClose ? (
            <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close todos panel">
              <IconX size={16} />
            </ActionIcon>
          ) : null}
        </Group>

        {total > 0 ? (
          <Box pt="xs">
            <Progress value={percent} size="xs" color="lagoon" radius="xl" animated={percent < 100} />
          </Box>
        ) : null}
      </Paper>

      <ScrollArea style={{ flex: 1 }} p="sm" type="auto">
        {!phases || phases.length === 0 || total === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="sm">
            <ThemeIcon size={40} radius="xl" variant="light" color="slate">
              <IconChecklist size={24} />
            </ThemeIcon>
            <Text size="sm" c="dimmed" ta="center" px="md">
              No tasks tracked yet. Multi-step work planned by the agent will appear here.
            </Text>
          </Stack>
        ) : (
          <Stack gap="md">
            {phases.map(phase => {
              const phaseTasks = phase.tasks;
              const phaseDone = phaseTasks.filter(t => t.status === "completed").length;

              return (
                <Card key={phase.name} padding="xs" radius="sm" withBorder>
                  <Group justify="space-between" mb={6} wrap="nowrap">
                    <Text size="xs" fw={700} tt="uppercase" c="dimmed" truncate>
                      {phase.name}
                    </Text>
                    <Badge size="xs" variant="outline" color="slate">
                      {phaseDone}/{phaseTasks.length}
                    </Badge>
                  </Group>

                  <Stack gap={2}>
                    {phaseTasks.map((task, idx) => (
                      <TaskItem key={`${phase.name}-${idx}`} task={task} />
                    ))}
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
