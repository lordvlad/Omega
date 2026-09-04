/**
 * Workspaces, with their sessions nested underneath.
 *
 * Grouping is the server's, keyed by each session's recorded `cwd`. The tree
 * starts collapsed except for the workspace holding the open session, because
 * this list is long on a real machine and the phone viewport is short.
 */
import {
  Accordion,
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { IconFolderPlus, IconPlus, IconRefresh } from "@tabler/icons-react";

import type { SessionStatus, SessionSummary, Workspace } from "../api/model.ts";

/** Badge colour per omp session status. */
const STATUS_COLOR: Record<SessionStatus, string> = {
  complete: "lagoon",
  interrupted: "yellow",
  aborted: "orange",
  error: "red",
  pending: "blue",
  unknown: "slate",
};

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface SessionTreeProps {
  workspaces: Workspace[];
  loading: boolean;
  /** Session UUID currently open, if any. */
  activeSessionId?: string;
  onOpenSession: (session: SessionSummary) => void;
  onNewSession: (cwd: string) => void;
  onAddWorkspace: () => void;
  onRefresh: () => void;
}

export function SessionTree({
  workspaces,
  loading,
  activeSessionId,
  onOpenSession,
  onNewSession,
  onAddWorkspace,
  onRefresh,
}: SessionTreeProps) {
  // Open the workspace containing the active session, so switching sessions
  // does not collapse the list you are working in.
  const activeWorkspace = workspaces.find(workspace =>
    workspace.sessions.some(session => session.id === activeSessionId),
  );

  return (
    <Stack gap="xs" h="100%">
      <Group justify="space-between" px="xs" pt="xs" wrap="nowrap">
        <Text fw={650} size="sm" c="dimmed" tt="uppercase">
          Workspaces
        </Text>
        <Group gap={4} wrap="nowrap">
          <Tooltip label="Open a directory">
            <ActionIcon onClick={onAddWorkspace} aria-label="Open a directory">
              <IconFolderPlus size={18} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Refresh">
            <ActionIcon onClick={onRefresh} aria-label="Refresh session list">
              {loading ? <Loader size={14} /> : <IconRefresh size={18} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      <ScrollArea style={{ flex: 1 }} type="auto" offsetScrollbars>
        {workspaces.length === 0 && !loading ? (
          <Text size="sm" c="dimmed" px="sm" py="lg">
            No omp sessions found yet. Open a directory to start one.
          </Text>
        ) : null}

        <Accordion
          multiple
          defaultValue={activeWorkspace ? [activeWorkspace.cwd] : []}
          variant="filled"
          chevronPosition="left"
        >
          {workspaces.map(workspace => (
            <Accordion.Item key={workspace.cwd} value={workspace.cwd}>
              <Accordion.Control>
                <Group gap="xs" wrap="nowrap" justify="space-between" pr="xs">
                  <Box style={{ minWidth: 0 }}>
                    <Text size="sm" fw={600} truncate>
                      {workspace.name}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {workspace.cwd}
                    </Text>
                  </Box>
                  <Badge size="sm" variant="light" color={workspace.exists ? "plum" : "slate"}>
                    {workspace.sessions.length}
                  </Badge>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap={4}>
                  <Button
                    size="compact-sm"
                    variant="light"
                    color="lagoon"
                    leftSection={<IconPlus size={14} />}
                    onClick={() => onNewSession(workspace.cwd)}
                    disabled={!workspace.exists}
                  >
                    New session
                  </Button>
                  {workspace.sessions.map(session => (
                    <Box
                      key={session.path}
                      component="button"
                      type="button"
                      onClick={() => onOpenSession(session)}
                      className="omega-session-row"
                      data-active={session.id === activeSessionId || undefined}
                    >
                      <Group gap={6} justify="space-between" wrap="nowrap">
                        <Text size="sm" truncate style={{ minWidth: 0 }}>
                          {session.title || session.firstMessage || "Untitled session"}
                        </Text>
                        {session.live ? (
                          <Badge size="xs" color="lagoon" variant="filled">
                            live
                          </Badge>
                        ) : null}
                      </Group>
                      <Group gap={6} wrap="nowrap">
                        <Badge size="xs" variant="dot" color={STATUS_COLOR[session.status]}>
                          {session.status}
                        </Badge>
                        <Text size="xs" c="dimmed">
                          {session.messageCount} msg · {relative(session.modified)}
                        </Text>
                      </Group>
                    </Box>
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </ScrollArea>
    </Stack>
  );
}
