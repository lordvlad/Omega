import { CodeHighlight } from "@mantine/code-highlight";
/**
 * The chat transcript.
 *
 * Thinking and tool calls are collapsed by default and text is not: reasoning
 * and tool traffic are context you open when you want it, while the answer is
 * the thing you came for. A thinking block that is still streaming opens
 * itself, so a long silent reasoning pass shows progress instead of a spinner.
 */
import { Alert, Badge, Box, Collapse, Group, Paper, Stack, Text, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconBrain, IconChevronRight, IconTerminal2, IconUser } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import type { MessagePart, TranscriptMessage } from "../api/model.ts";
import { Markdown } from "../lib/markdown.tsx";

/** A collapsible section with a persistent header. */
function Foldable({
  icon,
  label,
  meta,
  tone,
  openInitially,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  meta?: string;
  tone: "plum" | "lagoon" | "red";
  openInitially: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(openInitially);
  // A block that starts streaming should reveal itself, but must not fight a
  // user who has since collapsed it — so only the transition to `true` acts.
  const previous = useRef(openInitially);
  useEffect(() => {
    if (openInitially && !previous.current) setOpen(true);
    previous.current = openInitially;
  }, [openInitially]);

  return (
    <Box className="omega-foldable" data-tone={tone}>
      <UnstyledButton onClick={() => setOpen(value => !value)} className="omega-foldable-head">
        <Group gap={8} wrap="nowrap">
          <Box className="omega-foldable-chevron" data-open={open || undefined}>
            <IconChevronRight size={14} />
          </Box>
          {icon}
          <Text size="xs" fw={650} tt="uppercase" c={tone === "red" ? "red.4" : `${tone}.3`}>
            {label}
          </Text>
          {meta ? (
            <Text size="xs" c="dimmed" truncate style={{ minWidth: 0 }}>
              {meta}
            </Text>
          ) : null}
        </Group>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Box className="omega-foldable-body">{children}</Box>
      </Collapse>
    </Box>
  );
}

function ToolPart({ part, streaming }: { part: MessagePart; streaming: boolean }) {
  // Arguments stream in as JSON text and are only valid once complete, so
  // pretty-printing is attempted and the raw text kept when it fails.
  let args = part.args ?? "";
  if (args) {
    try {
      args = JSON.stringify(JSON.parse(args), null, 2);
    } catch {
      // Still streaming, or not JSON; show it as it arrived.
    }
  }
  return (
    <Foldable
      icon={<IconTerminal2 size={14} />}
      label={part.toolName ?? "tool"}
      meta={part.isError ? "failed" : streaming && !part.text ? "running…" : undefined}
      tone={part.isError ? "red" : "lagoon"}
      openInitially={part.isError === true}
    >
      <Stack gap={6}>
        {args && args !== "{}" ? <CodeHighlight code={args} language="json" withCopyButton={false} /> : null}
        {part.text ? <CodeHighlight code={part.text} language="text" withCopyButton={false} /> : null}
      </Stack>
    </Foldable>
  );
}

function Part({ part, streaming }: { part: MessagePart; streaming: boolean }) {
  switch (part.kind) {
    case "text":
      return <Markdown text={part.text} />;
    case "thinking":
      return (
        <Foldable
          icon={<IconBrain size={14} />}
          label="Thinking"
          tone="plum"
          // Reveal a thinking block while it is the live edge of the turn.
          openInitially={streaming}
        >
          <Box className="omega-thinking">
            <Markdown text={part.text} />
          </Box>
        </Foldable>
      );
    case "toolCall":
    case "toolResult":
      return <ToolPart part={part} streaming={streaming} />;
    default:
      return null;
  }
}

function Message({ message, streaming }: { message: TranscriptMessage; streaming: boolean }) {
  if (message.role === "user") {
    return (
      <Group justify="flex-end" align="flex-start" gap="xs" wrap="nowrap">
        <Paper className="omega-user-bubble" p="sm" radius="lg">
          {message.parts.map((part, index) => (
            <Markdown key={index} text={part.text} />
          ))}
        </Paper>
        <Box className="omega-avatar" data-role="user">
          <IconUser size={14} />
        </Box>
      </Group>
    );
  }

  return (
    <Stack gap={6} className="omega-assistant">
      {message.parts.map((part, index) => (
        <Part
          key={`${message.id}-${index}`}
          part={part}
          // Only the last part of a streaming message is the live edge.
          streaming={streaming && index === message.parts.length - 1}
        />
      ))}
    </Stack>
  );
}

export interface TranscriptProps {
  messages: TranscriptMessage[];
  /** Parts of the turn currently streaming, if any. */
  liveParts: MessagePart[];
  running: boolean;
  error?: string;
  notices: string[];
}

export function Transcript({ messages, liveParts, running, error, notices }: TranscriptProps) {
  const bottom = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the stream only while the user is already at the bottom; yanking
  // the viewport away from someone reading scrollback is worse than not
  // following at all.
  useEffect(() => {
    const anchor = bottom.current;
    if (!anchor) return;
    const scroller = anchor.closest(".omega-scroll");
    if (!scroller) return;
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    pinned.current = distance < 160;
    if (pinned.current) anchor.scrollIntoView({ block: "end" });
  }, [messages, liveParts]);

  return (
    <Stack gap="lg" pb="xl">
      {messages.length === 0 && liveParts.length === 0 && !running ? (
        <Text c="dimmed" ta="center" py="xl" size="sm">
          No messages yet. Say something below.
        </Text>
      ) : null}

      {messages.map(message => (
        <Message key={message.id} message={message} streaming={false} />
      ))}

      {liveParts.length > 0 ? (
        <Message message={{ id: "live", role: "assistant", parts: liveParts }} streaming={running} />
      ) : null}

      {running && liveParts.length === 0 ? (
        <Group gap="xs">
          <Badge color="plum" variant="light" className="omega-pulse">
            working
          </Badge>
        </Group>
      ) : null}

      {notices.map((notice, index) => (
        <Alert key={index} variant="light" color="lagoon" title="Notice">
          {notice}
        </Alert>
      ))}

      {error ? (
        <Alert variant="light" color="red" icon={<IconAlertTriangle size={16} />} title="Turn failed">
          {error}
        </Alert>
      ) : null}

      <div ref={bottom} />
    </Stack>
  );
}
