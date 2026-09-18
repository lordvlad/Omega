/**
 * The annotations panel: everything marked up but not yet sent.
 *
 * Annotations are made while reading, one at a time, in two different places —
 * so this is where they are read back as a list before they ride along with
 * the next message. Each row says where it came from, because that reference
 * is the whole point of having made it rather than typing it out.
 *
 * Only the note text is editable. The position it points at was captured from
 * a real selection or a real drop, and letting it be typed over would turn a
 * reference into a guess; a wrong row is deleted, not corrected.
 */
import {
  ActionIcon,
  Badge,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconDeviceFloppy, IconHighlight, IconPencil, IconTrash, IconX } from "@tabler/icons-react";
import { useState } from "react";

import type { Annotation } from "../lib/annotations.ts";

export interface AnnotationsPanelProps {
  annotations: Annotation[];
  /** Edit the note text. Nothing else about an annotation is editable. */
  onEdit: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  /** Open the file a file annotation points at. */
  onOpenFile?: (path: string) => void;
  onClose?: () => void;
}

const KIND_BADGE: Record<Annotation["kind"], { label: string; color: string }> = {
  file: { label: "file", color: "plum" },
  drawing: { label: "drawing", color: "red" },
  note: { label: "note", color: "yellow" },
};

const VIEW_LABEL: Record<"raw" | "diff" | "rendered", string> = {
  raw: "file view",
  diff: "diff",
  rendered: "rendered markdown",
};

const MONO = { fontFamily: "var(--mantine-font-family-monospace)" };

function AnnotationRow({
  annotation,
  onEdit,
  onDelete,
  onOpenFile,
}: {
  annotation: Annotation;
  onEdit: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onOpenFile?: (path: string) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const editing = draft !== undefined;
  const badge = KIND_BADGE[annotation.kind];

  const save = (): void => {
    const note = (draft ?? "").trim();
    // Blanking a note is a delete in disguise, and the button that means
    // delete is the one that has to be pressed.
    if (!note || note === annotation.note) {
      setDraft(undefined);
      return;
    }
    onEdit(annotation.id, note);
    setDraft(undefined);
  };

  const reference = (): React.ReactNode => {
    if (annotation.kind === "file") {
      const span =
        annotation.startLine !== undefined
          ? ` · L${annotation.startLine}:${annotation.startChar ?? 1}–L${annotation.endLine ?? annotation.startLine}:${annotation.endChar ?? 1}`
          : "";
      const inFile = annotation.fileLine !== undefined ? ` · file L${annotation.fileLine}` : "";
      const tail = ` · ${VIEW_LABEL[annotation.view]}${span}${inFile}`;
      return (
        <Group gap={0} wrap="nowrap" style={{ minWidth: 0 }}>
          {onOpenFile ? (
            <Tooltip label="Open in the file viewer" position="top-start">
              <UnstyledButton onClick={() => onOpenFile(annotation.path)}>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ ...MONO, textDecoration: "underline", textUnderlineOffset: "3px" }}
                >
                  {annotation.path}
                </Text>
              </UnstyledButton>
            </Tooltip>
          ) : (
            <Text size="xs" c="dimmed" style={MONO}>
              {annotation.path}
            </Text>
          )}
          <Text size="xs" c="dimmed" style={MONO}>
            {tail}
          </Text>
        </Group>
      );
    }
    if (annotation.kind === "drawing") {
      const over = annotation.targets.length > 0 ? ` over ${annotation.targets.join(", ")}` : "";
      return (
        <Text size="xs" c="dimmed" style={MONO}>
          surface {annotation.surfaceId} · drawing{over}
        </Text>
      );
    }
    const on = annotation.target ? ` on ${annotation.target}` : "";
    return (
      <Text size="xs" c="dimmed" style={MONO}>
        surface {annotation.surfaceId} · note at {Math.round(annotation.x * 100)}%,{" "}
        {Math.round(annotation.y * 100)}%{on}
      </Text>
    );
  };

  return (
    <Paper withBorder p="xs" radius="sm">
      <Stack gap={6}>
        <Group gap={6} justify="space-between" wrap="nowrap">
          <Badge size="xs" variant="light" color={badge.color}>
            {badge.label}
          </Badge>

          <Group gap={4} wrap="nowrap">
            {editing ? (
              <>
                <Tooltip label="Save">
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="cyan"
                    onClick={save}
                    aria-label="Save annotation"
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
              <Tooltip label="Edit the note">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="plum"
                  onClick={() => setDraft(annotation.note)}
                  aria-label="Edit annotation"
                >
                  <IconPencil size={15} />
                </ActionIcon>
              </Tooltip>
            )}
            <Tooltip label="Delete this annotation">
              <ActionIcon
                size="sm"
                variant="subtle"
                color="red"
                onClick={() => onDelete(annotation.id)}
                aria-label="Delete annotation"
              >
                <IconTrash size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        {reference()}

        {annotation.kind === "file" && annotation.excerpt ? (
          <Text size="xs" lineClamp={4} style={{ ...MONO, whiteSpace: "pre-wrap", opacity: 0.75 }}>
            {annotation.excerpt}
          </Text>
        ) : null}

        {editing ? (
          <Textarea
            autosize
            minRows={2}
            maxRows={10}
            size="xs"
            value={draft}
            onChange={event => setDraft(event.currentTarget.value)}
            onKeyDown={event => {
              // Same contract as the composer: Ctrl/⌘+Enter commits, Enter is
              // a newline, Escape abandons the edit.
              if (event.key === "Escape") {
                event.preventDefault();
                setDraft(undefined);
                return;
              }
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              save();
            }}
            aria-label="Annotation text"
          />
        ) : (
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {annotation.note.trim() || (
              <Text span c="dimmed" size="sm" fs="italic">
                (no text)
              </Text>
            )}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

export function AnnotationsPanel({
  annotations,
  onEdit,
  onDelete,
  onClear,
  onOpenFile,
  onClose,
}: AnnotationsPanelProps) {
  return (
    <Stack gap={0} h="100%">
      <Paper h={56} withBorder radius={0} style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Group justify="space-between" align="center" wrap="nowrap" h="100%" px="sm">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <IconHighlight size={18} color="var(--mantine-color-plum-4)" />
            <Text size="sm" fw={700}>
              Annotations
            </Text>
            <Badge size="xs" variant="light" color="plum">
              {annotations.length}
            </Badge>
          </Group>
          <Group gap={6} wrap="nowrap">
            {annotations.length > 0 ? (
              <Tooltip label="Delete every annotation">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="red"
                  onClick={onClear}
                  aria-label="Delete every annotation"
                >
                  <IconTrash size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}
            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close annotations panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Paper>

      {annotations.length === 0 ? (
        <Stack gap="xs" p="md" align="center">
          <Text size="sm" c="dimmed" ta="center">
            No annotations yet.
          </Text>
          <Text size="xs" c="dimmed" ta="center">
            Select text in the file viewer, or use the pen and sticky-note tools on a surface the agent drew.
            Whatever is here rides along with your next message.
          </Text>
        </Stack>
      ) : (
        <ScrollArea style={{ flex: 1 }} type="auto">
          <Stack gap="xs" p="md">
            {annotations.map(annotation => (
              <AnnotationRow
                key={annotation.id}
                annotation={annotation}
                onEdit={onEdit}
                onDelete={onDelete}
                onOpenFile={onOpenFile}
              />
            ))}
          </Stack>
        </ScrollArea>
      )}
    </Stack>
  );
}
