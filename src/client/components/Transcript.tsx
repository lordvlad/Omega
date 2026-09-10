import { CodeHighlight } from "@mantine/code-highlight";
/**
 * The chat transcript.
 *
 * Thinking and tool calls are collapsed by default and text is not: reasoning
 * and tool traffic are context you open when you want it, while the answer is
 * the thing you came for. A thinking block that is still streaming opens
 * itself, so a long silent reasoning pass shows progress instead of a spinner.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Collapse,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconBrain,
  IconChevronRight,
  IconTerminal2,
  IconTools,
  IconUser,
} from "@tabler/icons-react";
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
        {args && args !== "{}" ? <CodeHighlight code={args} language="json" /> : null}
        {part.text ? <CodeHighlight code={part.text} language="text" /> : null}
      </Stack>
    </Foldable>
  );
}

/**
 * Two or more consecutive tool parts grouped under one collapsible.
 *
 * The outer foldable shows the count (and an error badge when any member
 * failed) and is collapsed by default once the group is complete. Each
 * inner ToolPart keeps its own independent open state.
 */
function ToolGroup({
  parts,
  streaming,
  messageId,
  baseIndex,
}: {
  parts: MessagePart[];
  streaming: boolean;
  messageId: string;
  baseIndex: number;
}) {
  const hasError = parts.some(p => p.isError);
  // Count calls per tool name (results share their call's name, so every
  // part contributes). "read ×3, bash ×2" tells more than "5 tool calls".
  const counts = new Map<string, number>();
  for (const p of parts) {
    const name = p.toolName ?? "tool";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const label = [...counts].map(([name, n]) => (n === 1 ? name : `${name} ×${n}`)).join(", ");
  return (
    <Foldable
      icon={<IconTools size={14} />}
      label={label}
      meta={hasError ? "failed" : streaming ? "running…" : undefined}
      tone={hasError ? "red" : "cyan"}
      openInitially={streaming}
    >
      <Stack gap={4}>
        {parts.map((part, i) => (
          <ToolPart
            key={`${messageId}-${baseIndex + i}`}
            part={part}
            streaming={streaming && i === parts.length - 1}
          />
        ))}
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

function isToolPart(part: MessagePart): boolean {
  return part.kind === "toolCall" || part.kind === "toolResult";
}

/**
 * Collapse consecutive tool parts into groups. A run of two or more gets a
 * ToolGroup wrapper; a lone tool part renders directly as a ToolPart so no
 * extra nesting level appears for the common single-call case.
 */
type PartSlot =
  | { kind: "single"; part: MessagePart; index: number }
  | { kind: "group"; parts: MessagePart[]; baseIndex: number };

function groupParts(parts: MessagePart[]): PartSlot[] {
  const slots: PartSlot[] = [];
  let i = 0;
  while (i < parts.length) {
    const current = parts[i]!;
    if (isToolPart(current)) {
      const start = i;
      while (i < parts.length && isToolPart(parts[i]!)) i++;
      const run = parts.slice(start, i);
      if (run.length === 1) {
        slots.push({ kind: "single", part: run[0]!, index: start });
      } else {
        slots.push({ kind: "group", parts: run, baseIndex: start });
      }
    } else {
      slots.push({ kind: "single", part: current, index: i });
      i++;
    }
  }
  return slots;
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

  const slots = groupParts(message.parts);
  const lastSlot = slots[slots.length - 1];

  return (
    <Stack gap={12}>
      {slots.map(slot => {
        // The live edge of a streaming message is always the last slot.
        const slotStreaming = streaming && slot === lastSlot;
        if (slot.kind === "group") {
          return (
            <ToolGroup
              key={`${message.id}-group-${slot.baseIndex}`}
              parts={slot.parts}
              streaming={slotStreaming}
              messageId={message.id}
              baseIndex={slot.baseIndex}
            />
          );
        }
        return <Part key={`${message.id}-${slot.index}`} part={slot.part} streaming={slotStreaming} />;
      })}
    </Stack>
  );
}

export interface TranscriptProps {
  messages: TranscriptMessage[];
  /** Parts of the turn currently streaming, if any. */
  liveParts: MessagePart[];
  /**
   * Messages the user just sent that the server transcript has not returned
   * yet, shown so typing is never answered by a blank screen.
   */
  pendingUser: string[];
  running: boolean;
  error?: string;
  notices: string[];
  /** True while the transcript for an open session is still being fetched. */
  loading?: boolean;
}

type TranscriptItem =
  | { kind: "message"; id: string; message: TranscriptMessage; streaming: boolean }
  | { kind: "separator"; id: string; label: string }
  | { kind: "working" }
  | { kind: "notice"; index: number; notice: string }
  | { kind: "error"; error: string };

/**
 * Format a timestamp for a turn separator.
 *
 * - <1 h ago  → relative ("3m ago", "just now")
 * - today, ≥1 h → time only ("2:45 PM")
 * - older     → date + time ("Sep 7, 3:12 PM")
 */
function formatTurnTime(iso: string, now: Date): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const diffMs = now.getTime() - date.getTime();
  // Floored, not rounded: 45 s is still "just now", not a minute that has
  // not elapsed. A negative diff (server clock slightly ahead) reads the same.
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  if (sameDay) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function Transcript({
  messages,
  liveParts,
  pendingUser,
  running,
  error,
  notices,
  loading = false,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  // Flatten messages, in-flight streaming turn, notices and errors into a unified virtual list.
  const items = useMemo<TranscriptItem[]>(() => {
    const now = new Date();
    const result: TranscriptItem[] = [];

    for (const msg of messages) {
      // Insert a separator before each message that carries a timestamp,
      // except when the previous separator would show the same label
      // (back-to-back messages in the same minute).
      if (msg.timestamp) {
        const label = formatTurnTime(msg.timestamp, now);
        const prev = result.findLast(r => r.kind === "separator");
        if (label && (!prev || prev.label !== label)) {
          result.push({ kind: "separator", id: `sep-${msg.id}`, label });
        }
      }
      result.push({ kind: "message", id: msg.id, message: msg, streaming: false });
    }

    // Echoes sit after the persisted history and before the reply they
    // provoked, which is where the server will place them once it catches up.
    for (const [index, text] of pendingUser.entries()) {
      result.push({
        kind: "message",
        id: `pending-${index}`,
        message: { id: `pending-${index}`, role: "user", parts: [{ kind: "text", text }] },
        streaming: false,
      });
    }

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
  }, [messages, liveParts, pendingUser, running, notices, error]);

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
      if (item.kind === "separator") return item.id;
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
    const isBottom = distance <= BOTTOM_GRACE_PX;
    pinned.current = isBottom;
    setAtBottom(isBottom);
  }, []);

  // New messages, streamed tokens, and height changes from markdown rendering
  // or a toggled thinking block all re-tail — but only while pinned, so a user
  // reading scrollback is never yanked to the end.
  const totalSize = virtualizer.getTotalSize();
  useEffect(tail, [items.length, liveParts, totalSize, tail]);

  return (
    <Box style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box
        ref={scrollRef}
        className="omega-scroll"
        px="sm"
        pt="sm"
        onScroll={handleScroll}
        style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
      >
        {items.length === 0 && loading ? (
          // A session in the URL always has history behind it; "no messages"
          // would be a lie told for as long as the fetch takes.
          <Stack align="center" justify="center" gap="sm" py="xl">
            <Loader size="sm" color="plum" />
            <Text c="dimmed" size="sm">
              Loading conversation…
            </Text>
          </Stack>
        ) : items.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl" size="sm">
            No messages yet. Say something below.
          </Text>
        ) : (
          <div
            className="omega-measure"
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
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
                      case "separator":
                        return (
                          <Group gap="sm" align="center" wrap="nowrap" className="omega-separator">
                            <Box style={{ flex: 1, height: 1 }} className="omega-separator-line" />
                            <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                              {item.label}
                            </Text>
                            <Box style={{ flex: 1, height: 1 }} className="omega-separator-line" />
                          </Group>
                        );
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

      {!atBottom ? (
        <Tooltip label="Scroll to bottom" position="left">
          <ActionIcon
            variant="filled"
            color="plum"
            size="lg"
            radius="xl"
            onClick={() => {
              pinned.current = true;
              setAtBottom(true);
              const el = scrollRef.current;
              if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            }}
            style={{
              position: "absolute",
              bottom: 16,
              // Hug the conversation column, not the window: on a wide screen
              // the gutter is empty page, and a control stranded out there
              // reads as belonging to nothing. Inline because Mantine's own
              // `position: relative` on the ActionIcon root would win against
              // a stylesheet rule of equal specificity.
              right: "max(20px, calc((100% - var(--omega-measure)) / 2 + 20px))",
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
              zIndex: 10,
            }}
            aria-label="Scroll to bottom"
          >
            <IconArrowDown size={20} />
          </ActionIcon>
        </Tooltip>
      ) : null}
    </Box>
  );
}
