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
  Menu,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useClipboard } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconArrowDown,
  IconBrain,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconGitBranch,
  IconTerminal2,
  IconTools,
  IconUser,
} from "@tabler/icons-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

/**
 * Per-message actions, revealed by clicking the message.
 *
 * Absolutely positioned, and deliberately so: the control appears mid-read,
 * and anything that occupied layout would reflow the paragraph under the
 * cursor at the moment of the click. `top` comes from where the click landed,
 * so the control meets the pointer instead of the pointer hunting for it.
 */
function MessageMenu({
  top,
  copyText,
  forkFrom,
  onFork,
}: {
  top: number;
  copyText: string;
  forkFrom: string | undefined;
  onFork: ((entryId: string) => void) | undefined;
}) {
  const clipboard = useClipboard({ timeout: 1200 });

  return (
    <Menu position="bottom-end" shadow="md" width={190} withinPortal>
      <Menu.Target>
        <ActionIcon
          className="omega-msg-menu"
          // Position inline, not in the stylesheet: Mantine sets `position:
          // relative` on the ActionIcon root, which beats a rule of equal
          // specificity. `top` is the click offset; the transform lifts the
          // control onto the line that was actually pointed at.
          style={{ position: "absolute", top, boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)" }}
          variant="filled"
          color="plum"
          size="md"
          radius="xl"
          aria-label="Message actions"
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconCopy size={14} />}
          disabled={!copyText}
          onClick={() => clipboard.copy(copyText)}
        >
          {clipboard.copied ? "Copied" : "Copy"}
        </Menu.Item>
        {forkFrom !== undefined && onFork ? (
          <Menu.Item leftSection={<IconGitBranch size={14} />} onClick={() => onFork(forkFrom)}>
            Fork from here
          </Menu.Item>
        ) : null}
      </Menu.Dropdown>
    </Menu>
  );
}

function Message({
  message,
  streaming,
  armedAt,
  onArm,
  onFork,
}: {
  message: TranscriptMessage;
  streaming: boolean;
  /** Offset within this message where the menu sits, or undefined if unarmed. */
  armedAt: number | undefined;
  onArm: (offset: number) => void;
  onFork?: (entryId: string) => void;
}) {
  // Only the prose is worth copying: tool parts hold rendered output, and a
  // transcript of someone else's shell session is not what "copy" promises.
  const copyText = message.parts
    .filter(part => part.kind === "text")
    .map(part => part.text)
    .join("\n\n")
    .trim();
  // omp branches from user entries only, so an assistant message offers copy
  // alone rather than an action that would fail on use.
  const forkFrom = message.role === "user" ? message.entryId : undefined;

  const arm = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // Leave the message's own controls alone: a click on a tool's disclosure
    // or a link is that click, not a request for this menu.
    if (event.target instanceof Element && event.target.closest("a,button,[role='button']")) return;
    // Selecting text ends in a click; arming on it would fight the selection.
    if (window.getSelection()?.isCollapsed === false) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onArm(event.clientY - bounds.top);
  };

  const menu =
    armedAt === undefined ? null : (
      <MessageMenu top={armedAt} copyText={copyText} forkFrom={forkFrom} onFork={onFork} />
    );

  if (message.role === "user") {
    return (
      // The row, not the bubble, anchors the menu, so every message's control
      // lands on the same vertical line in the margin whatever its width —
      // and clear of the avatar, which owns the right of this row.
      <div className="omega-msg" data-role="user" onClick={arm}>
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
        {menu}
      </div>
    );
  }

  const slots = groupParts(message.parts);
  const lastSlot = slots[slots.length - 1];

  return (
    <div className="omega-msg" data-role="assistant" onClick={arm}>
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
      {menu}
    </div>
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
  /**
   * Start a new branch from a user message. Omitted while no session can
   * accept one, which hides the action rather than offering a dead control.
   */
  onFork?: (entryId: string) => void;
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
  onFork,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /**
   * Which message is showing its actions, and where in it the click landed.
   *
   * Held here rather than per message because the list is virtualised: a
   * message scrolled out of view is unmounted, and state living inside it
   * would be lost on the way back. Holding one also means arming a message
   * disarms the last, so the conversation never accumulates controls.
   */
  const [armed, setArmed] = useState<{ id: string; offset: number } | undefined>(undefined);

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

  /** Pending tail frame, so a burst of measurements yields one scroll write. */
  const tailFrame = useRef<number | undefined>(undefined);

  /** Pin to the bottom, once the frame that measured the rows has finished. */
  const tail = useCallback(() => {
    // Two deferrals, for two different hazards.
    //
    // Coalescing, because the effect below runs on every measured row: a
    // transcript restored from cache mounts twenty rows in one commit, and
    // twenty queued writes of the same scrollTop is pure waste.
    //
    // Then a second frame, because writing scrollTop is what decides which
    // rows exist: the virtualizer reacts by mounting and unmounting, which
    // resizes elements its own ResizeObserver is watching. Landing that
    // inside the observer's delivery cycle is what produces "ResizeObserver
    // loop completed with undelivered notifications". The first frame lets
    // measurement and delivery finish; the write goes in the next one.
    // `scrollToIndex` is avoided for the same reason — it flushes
    // synchronously from inside the lifecycle.
    if (tailFrame.current !== undefined) cancelAnimationFrame(tailFrame.current);
    tailFrame.current = requestAnimationFrame(() => {
      tailFrame.current = requestAnimationFrame(() => {
        tailFrame.current = undefined;
        const el = scrollRef.current;
        if (!el || !pinned.current) return;
        el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  useEffect(
    () => () => {
      if (tailFrame.current !== undefined) cancelAnimationFrame(tailFrame.current);
    },
    [],
  );

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
                        return (
                          <Message
                            message={item.message}
                            streaming={item.streaming}
                            armedAt={armed?.id === item.id ? armed.offset : undefined}
                            onArm={offset => setArmed({ id: item.id, offset })}
                            onFork={onFork}
                          />
                        );
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
