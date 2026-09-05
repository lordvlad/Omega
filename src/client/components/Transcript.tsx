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
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  tone: "plum" | "cyan" | "red";
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
      tone={part.isError ? "red" : "cyan"}
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

type TranscriptItem =
  | { kind: "message"; id: string; message: TranscriptMessage; streaming: boolean }
  | { kind: "working" }
  | { kind: "notice"; index: number; notice: string }
  | { kind: "error"; error: string };

export function Transcript({ messages, liveParts, running, error, notices }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Flatten messages, in-flight streaming turn, notices and errors into a unified virtual list.
  const items = useMemo<TranscriptItem[]>(() => {
    const result: TranscriptItem[] = messages.map(msg => ({
      kind: "message",
      id: msg.id,
      message: msg,
      streaming: false,
    }));

    if (liveParts.length > 0) {
      result.push({
        kind: "message",
        id: "live",
        message: { id: "live", role: "assistant", parts: liveParts },
        streaming: running,
      });
    } else if (running) {
      result.push({ kind: "working" });
    }

    for (let i = 0; i < notices.length; i++) {
      result.push({ kind: "notice", index: i, notice: notices[i]! });
    }

    if (error) {
      result.push({ kind: "error", error });
    }

    return result;
  }, [messages, liveParts, running, notices, error]);

  // Virtualizer dynamically measures element heights via ResizeObserver (measureElement).
  // Handles variable heights from one-line chats to long code blocks and expanded thinking.
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 80,
    overscan: 5,
    getItemKey: index => {
      const item = items[index];
      if (!item) return index;
      if (item.kind === "message") return item.id;
      if (item.kind === "notice") return `notice-${item.index}`;
      return item.kind;
    },
  });

  /**
   * Distance from the bottom, in pixels, still counted as "at the bottom".
   *
   * Sub-pixel scroll heights and the resize that lands with each streamed
   * chunk mean an exact comparison never holds, so tailing needs a grace band
   * rather than equality.
   */
  const BOTTOM_GRACE_PX = 48;

  /** Pin to the bottom on the next frame. */
  const tail = useCallback(() => {
    // Deferred to a frame rather than run inline: the virtualizer measures
    // elements from a ResizeObserver, and writing scrollTop back inside that
    // callback is what produces "ResizeObserver loop completed with
    // undelivered notifications". `scrollToIndex` is avoided for the same
    // reason — it flushes synchronously from inside the lifecycle.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el || !pinned.current) return;
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Scrolling up unlocks tailing; scrolling back into the band re-locks it.
    pinned.current = distance <= BOTTOM_GRACE_PX;
  }, []);

  // New messages, streamed tokens, and height changes from markdown rendering
  // or a toggled thinking block all re-tail — but only while pinned, so a user
  // reading scrollback is never yanked to the end.
  const totalSize = virtualizer.getTotalSize();
  useEffect(tail, [items.length, liveParts, totalSize, tail]);

  return (
    <Box
      ref={scrollRef}
      className="omega-scroll"
      px="sm"
      pt="sm"
      onScroll={handleScroll}
      style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
    >
      {items.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl" size="sm">
          No messages yet. Say something below.
        </Text>
      ) : (
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map(virtualItem => {
            const item = items[virtualItem.index];
            if (!item) return null;
            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                  paddingBottom: 16,
                }}
              >
                {(() => {
                  switch (item.kind) {
                    case "message":
                      return <Message message={item.message} streaming={item.streaming} />;
                    case "working":
                      return (
                        <Group gap="xs">
                          <Badge color="plum" variant="light" className="omega-pulse">
                            working
                          </Badge>
                        </Group>
                      );
                    case "notice":
                      return (
                        <Alert variant="light" color="cyan" title="Notice">
                          {item.notice}
                        </Alert>
                      );
                    case "error":
                      return (
                        <Alert
                          variant="light"
                          color="red"
                          icon={<IconAlertTriangle size={16} />}
                          title="Turn failed"
                        >
                          {item.error}
                        </Alert>
                      );
                  }
                })()}
              </div>
            );
          })}
        </div>
      )}
    </Box>
  );
}
