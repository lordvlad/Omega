import { useState } from "react";
import { IconDeviceFloppy, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
/**
 * The queue panel.
 *
 * Messages sent while a turn is streaming wait in one of two lanes — steering,
 * delivered at the turn's next step, and follow-up, delivered when the turn
 * ends. Until then they are still just text, so they are editable: a queued
 * message is the one thing in the UI a user can still take back.
 *
 * Editing is per row and explicit. The agent drains the queue while the panel
 * is open, so a row is saved against the text it was opened with; the server
 * refuses the write if that slot changed underneath, and the fresh queue it
 * returns replaces what is on screen.
 */
import { ActionIcon, Badge, Group, Paper, ScrollArea, Stack, Text, Textarea, Tooltip } from "@mantine/core";
import type { QueuedMessage } from "../api/model.ts";

export interface QueuePanelProps {
  messages: QueuedMessage[];
  /** True while an edit or a drop is in flight; the whole list waits it out. */
  busy: boolean;
  onEdit: (message: QueuedMessage, text: string) => void;
  onDrop: (message: QueuedMessage) => void;
}

const LANE_LABEL: Record<QueuedMessage["lane"], string> = {
  steer: "Steer",
  followUp: "Queue",
};

const LANE_HINT: Record<QueuedMessage["lane"], string> = {
  steer: "Interrupts the turn at its next step",
  followUp: "Delivered once the turn finishes",
};

function QueueRow({
  message,
  busy,
  onEdit,
  onDrop,
}: {
  message: QueuedMessage;
  busy: boolean;
  onEdit: (message: QueuedMessage, text: string) => void;
  onDrop: (message: QueuedMessage) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const editing = draft !== undefined;

  const save = (): void => {
    const text = (draft ?? "").trim();
    // Blanking a message is a drop in disguise; the server refuses it, so the
    // button that means "delete" is the one that has to be pressed.
    if (!text || text === message.text) {
      setDraft(undefined);
      return;
    }
    onEdit(message, text);
    setDraft(undefined);
  };

  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap={6}>
        <Group gap={6} justify="space-between" wrap="nowrap">
          <Tooltip label={LANE_HINT[message.lane]} position="top-start">
            <Badge size="xs" variant="light" color={message.lane === "steer" ? "cyan" : "plum"}>
              {LANE_LABEL[message.lane]}
            </Badge>
          </Tooltip>

          <Group gap={4} wrap="nowrap">
            {editing ? (
              <>
                <Tooltip label="Save">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="cyan"
                    disabled={busy}
                    onClick={save}
                    aria-label="Save queued message"
                  >
                    <IconDeviceFloppy size={15} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Discard changes">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="plum"
                    onClick={() => setDraft(undefined)}
                    aria-label="Discard changes"
                  >
                    <IconX size={15} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : (
              <Tooltip label="Edit">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="plum"
                  disabled={busy}
                  onClick={() => setDraft(message.text)}
                  aria-label="Edit queued message"
                >
                  <IconPencil size={15} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Drop from the queue">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                disabled={busy}
                onClick={() => onDrop(message)}
                aria-label="Drop queued message"
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {editing ? (
          <Textarea
            autosize
            minRows={2}
            maxRows={10}
            size="xs"
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Same contract as the composer: Ctrl/⌘+Enter commits, Enter is
              // a newline, Escape abandons the edit.
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(undefined);
                return;
              }
              if (event.key !== "Enter" || event.nativeEvent.isComposing) {
                return;
              }
              if (!event.ctrlKey && !event.metaKey) {
                return;
              }
              event.preventDefault();
              save();
            }}
            aria-label="Queued message text"
          />
        ) : (
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {message.text || (
              <Text span c="dimmed" size="sm" fs="italic">
                (no text — images only)
              </Text>
            )}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function QueuePanel({ messages, busy, onEdit, onDrop }: QueuePanelProps) {
  if (messages.length === 0) {
    return (
      <Stack gap="xs" p="md" align="center">
        <Text size="sm" c="dimmed" ta="center">
          Nothing is queued.
        </Text>
        <Text size="xs" c="dimmed" ta="center">
          Messages sent while the agent is working wait here, and can be edited or dropped until it takes them.
        </Text>
      </Stack>
    );
  }

  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="xs" p="md">
        {messages.map((message) => (
          <QueueRow
            key={`${message.lane}:${message.index}`}
            message={message}
            busy={busy}
            onEdit={onEdit}
            onDrop={onDrop}
          />
        ))}
      </Stack>
    </ScrollArea>
  );
}

/** Re-exported so the drawer host and the composer agree on the empty case. */
export function queueSummary(messages: QueuedMessage[]): string {
  const steer = messages.filter((message) => message.lane === "steer").length;
  const followUp = messages.length - steer;
  if (steer && followUp) {
    return `${steer} steering, ${followUp} queued`;
  }
  if (steer) {
    return `${steer} steering`;
  }
  return `${followUp} queued`;
}
