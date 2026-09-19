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
  Button,
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
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconArrowBarToDown,
  IconArrowDownDashed,
  IconArrowUpDashed,
  IconBrain,
  IconChevronRight,
  IconCopy,
  IconDots,
  IconGitBranch,
  IconHistory,
  IconRefresh,
  IconRobot,
  IconTerminal2,
  IconTools,
  IconUser,
} from "@tabler/icons-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MessagePart, SubagentTask, TranscriptMessage } from "../api/model.ts";
import { copyText } from "../lib/clipboard.ts";
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
    case "error":
      // The same alert the live stream raises, so a turn that failed reads the
      // same whether you watched it happen or arrived afterwards.
      return (
        <Alert variant="light" color="red" icon={<IconAlertTriangle size={16} />} title="Turn failed">
          {part.text}
        </Alert>
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
 * Drop thinking and/or tool parts per the project's display settings.
 *
 * Filtered before grouping, not just visually collapsed: a live stream and a
 * persisted transcript both funnel through the same `Message` component, so
 * this is the one place that has to know about the toggle.
 */
function visibleParts(
  parts: MessagePart[],
  settings: { showThinking: boolean; showToolCalls: boolean },
): MessagePart[] {
  return parts.filter(part => {
    if (part.kind === "thinking") return settings.showThinking;
    if (isToolPart(part)) return settings.showToolCalls;
    return true;
  });
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
    } else if (current.kind === "thinking") {
      const start = i;
      const texts: string[] = [];
      while (i < parts.length && parts[i]!.kind === "thinking") {
        const text = parts[i]!.text.trim();
        if (text) texts.push(text);
        i++;
      }
      if (texts.length > 0) {
        slots.push({
          kind: "single",
          part: { kind: "thinking", text: texts.join("\n\n") },
          index: start,
        });
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
  text,
  forkFrom,
  onFork,
}: {
  top: number;
  /** Markdown of the message, as the clipboard should receive it. */
  text: string;
  forkFrom: string | undefined;
  onFork: ((entryId: string) => void) | undefined;
}) {
  // The menu closes on pick, so the result cannot be shown on the item
  // itself: a copy that quietly did nothing is exactly the bug this path had.
  const copy = async (): Promise<void> => {
    const copied = await copyText(text);
    notifications.show(
      copied
        ? { color: "cyan", message: "Copied to clipboard", autoClose: 1500 }
        : {
            color: "red",
            title: "Could not copy",
            message: "The browser refused the clipboard. Select the text and copy it by hand.",
          },
    );
  };

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
        <Menu.Item leftSection={<IconCopy size={14} />} disabled={!text} onClick={() => void copy()}>
          Copy
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
  showThinking,
  showToolCalls,
  subagents,
  onOpenSubagents,
}: {
  message: TranscriptMessage;
  streaming: boolean;
  /** Offset within this message where the menu sits, or undefined if unarmed. */
  armedAt: number | undefined;
  onArm: (offset: number) => void;
  onFork?: (entryId: string) => void;
  showThinking: boolean;
  showToolCalls: boolean;
  subagents?: SubagentTask[];
  onOpenSubagents?: () => void;
}) {
  // Only the prose is worth copying: tool parts hold rendered output, and a
  // transcript of someone else's shell session is not what "copy" promises.
  const prose = message.parts
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
      <MessageMenu top={armedAt} text={prose} forkFrom={forkFrom} onFork={onFork} />
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

  const slots = groupParts(visibleParts(message.parts, { showThinking, showToolCalls }));
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
        {streaming && slots.length > 0 ? (
          <Group gap="xs" mt={2}>
            {(() => {
              const activeCount = (subagents ?? []).filter(s => s.status === "running").length;
              return (
                <Badge
                  color="plum"
                  variant="light"
                  size="sm"
                  className="omega-pulse"
                  style={{ cursor: onOpenSubagents ? "pointer" : undefined }}
                  onClick={onOpenSubagents}
                  leftSection={activeCount > 0 ? <IconRobot size={13} /> : undefined}
                >
                  {activeCount > 0
                    ? `working (${activeCount} ${activeCount === 1 ? "sub-agent" : "sub-agents"})`
                    : "working"}
                </Badge>
              );
            })()}
          </Group>
        ) : null}
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
  showThinking: boolean;
  /** Show tool calls and their results; a per-project display preference. */
  showToolCalls: boolean;
  /** Active sub-agent tasks spawned during this session. */
  subagents?: SubagentTask[];
  /** Open the sub-agents drawer. */
  onOpenSubagents?: () => void;
  /**
   * True when the server left older messages out of this window.
   *
   * The transcript renders plain DOM, so the window is capped rather than
   * virtualised; this is what earns the control that grows it.
   */
  hasOlder?: boolean;
  /** True while a wider window is being fetched. */
  loadingOlder?: boolean;
  /** Fetch another page of older history. */
  onLoadOlder?: () => void;
  /**
   * Reload the conversation, as asked for by dragging up past the bottom.
   *
   * Awaited, so the indicator spins for exactly as long as the work takes.
   */
  onReload?: () => Promise<void> | void;
}

/** Drag distance that arms the reload, and the furthest the content travels. */
const PULL_TRIGGER_PX = 64;
const PULL_MAX_PX = 96;

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
  showThinking,
  showToolCalls,
  subagents,
  onOpenSubagents,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  onReload,
  children,
}: TranscriptProps & { children?: React.ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /** How far the content is dragged up past its bottom edge, in pixels. */
  const [pull, setPull] = useState(0);
  /** True while the reload the gesture asked for is in flight. */
  const [reloading, setReloading] = useState(false);
  /**
   * Which message is showing its actions, and where in it the click landed.
   *
   * Held here rather than per message because arming a message disarms the
   * last, so the conversation never accumulates controls.
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
    const visibleLive = visibleParts(liveParts, { showThinking, showToolCalls });
    if (visibleLive.length > 0) {
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
  }, [messages, liveParts, pendingUser, running, notices, error, showThinking, showToolCalls]);

  // Virtualizer removed: native DOM scrolling handles dynamic heights (like
  // markdown and code blocks) much better than virtualization does, allowing
  // tailing and "scroll to bottom" to work reliably on the first try.

  /**
   * Distance from the bottom, in pixels, still counted as "at the bottom".
   *
   * Sub-pixel scroll heights and the resize that lands with each streamed
   * chunk mean an exact comparison never holds, so tailing needs a grace band
   * rather than equality.
   */
  const BOTTOM_GRACE_PX = 96;

  /** Pending tail frame, so a burst of measurements yields one scroll write. */
  const tailFrame = useRef<number | undefined>(undefined);
  /** Pending delayed tail timers. */
  const tailTimers = useRef<number[]>([]);

  /** Pin to the bottom, once the frame that measured the rows has finished. */
  const tail = useCallback(() => {
    // Without virtualization, rendering is a standard DOM pass. Only one rAF
    // is needed to wait for layout before scrolling.
    if (tailFrame.current !== undefined) cancelAnimationFrame(tailFrame.current);
    tailFrame.current = requestAnimationFrame(() => {
      tailFrame.current = undefined;
      const el = scrollRef.current;
      if (!el || !pinned.current) return;
      el.scrollTop = el.scrollHeight;
    });
  }, []);

  /**
   * Schedule both immediate and delayed tail passes so late-measuring elements
   * (shiki syntax highlighting, parsed markdown, dynamic images) settle before
   * locking the final bottom scroll position.
   */
  const delayedTail = useCallback(
    (delays = [60, 180, 350]) => {
      tail();
      for (const d of delays) {
        const timer = window.setTimeout(() => {
          tail();
        }, d);
        tailTimers.current.push(timer);
      }
    },
    [tail],
  );

  useEffect(
    () => () => {
      if (tailFrame.current !== undefined) cancelAnimationFrame(tailFrame.current);
      for (const timer of tailTimers.current) window.clearTimeout(timer);
      tailTimers.current = [];
    },
    [],
  );

  /**
   * Release the tail only when the *user* leaves the bottom.
   *
   * A scroll event does not mean someone scrolled. Content growing — a
   * streamed paragraph, markdown replacing raw text, a settled transcript
   * replacing the streamed copy — moves the bottom away from a stationary
   * `scrollTop` and fires this handler with a large distance. Treating that
   * as "the user scrolled up" is what makes tailing give up mid-turn and
   * never come back.
   *
   * So the lock is only dropped when the position actually moved up, or when
   * a gesture said so. A gap that opened underneath a still viewport is
   * content arriving, and the answer to that is to follow it.
   */
  const lastTop = useRef(0);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    // A pixel of slack: sub-pixel scroll positions jitter on their own.
    const movedUp = top < lastTop.current - 1;
    lastTop.current = top;

    if (distance <= BOTTOM_GRACE_PX) {
      pinned.current = true;
      setAtBottom(true);
      return;
    }
    if (movedUp) {
      pinned.current = false;
      setAtBottom(false);
      return;
    }
    // Still pinned, but the bottom ran away: chase it.
    if (pinned.current) tail();
  }, [tail]);

  /**
   * Navigate to the previous or next user message in the conversation.
   */
  const navigateUserMessage = useCallback((direction: "prev" | "next") => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;
    const userNodes = Array.from(scrollEl.querySelectorAll<HTMLElement>('.omega-msg[data-role="user"]'));
    if (userNodes.length === 0) return;

    const currentScrollTop = scrollEl.scrollTop;
    const buffer = 40;

    if (direction === "prev") {
      const prevNodes = userNodes.filter(node => node.offsetTop < currentScrollTop - buffer);
      if (prevNodes.length > 0) {
        const target = prevNodes[prevNodes.length - 1]!;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        pinned.current = false;
        setAtBottom(false);
      } else {
        userNodes[0]!.scrollIntoView({ behavior: "smooth", block: "start" });
        pinned.current = false;
        setAtBottom(false);
      }
    } else {
      const nextNodes = userNodes.filter(node => node.offsetTop > currentScrollTop + buffer);
      if (nextNodes.length > 0) {
        const target = nextNodes[0]!;
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        pinned.current = false;
        setAtBottom(false);
      } else {
        pinned.current = true;
        setAtBottom(true);
        scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
      }
    }
  }, []);

  // New messages, streamed tokens, and height changes from markdown rendering
  // or a toggled thinking block all re-tail — but only while pinned, so a user
  // reading scrollback is never yanked to the end.
  useEffect(tail, [items.length, liveParts, tail]);

  // A submitted message is the user acting, not just new content arriving —
  // it always snaps the view back to the bottom and re-pins it there, even
  // if they had scrolled up to read back through history.
  const pendingCount = useRef(0);
  useEffect(() => {
    if (pendingUser.length > pendingCount.current) {
      pinned.current = true;
      setAtBottom(true);
      delayedTail([50, 150, 300]);
    }
    pendingCount.current = pendingUser.length;
  }, [pendingUser.length, delayedTail]);

  // When initial loading completes or messages first arrive on page load,
  // trigger delayed tailing so that late-measuring code blocks and images
  // don't leave the view stranded short of the bottom.
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!loading && items.length > 0 && !initialLoadDone.current) {
      initialLoadDone.current = true;
      pinned.current = true;
      setAtBottom(true);
      delayedTail([60, 180, 350]);
    }
  }, [loading, items.length, delayedTail]);

  /**
   * Focusing the composer means the reader is joining the conversation at the
   * end of it.
   *
   * On a phone this is also the moment the keyboard opens: the column gets
   * shorter underneath a stationary scroll position, and the last thing said
   * slides out of view. Re-pinning here, with passes spread across the
   * keyboard's animation, is what keeps the newest message above the field
   * being typed into without anyone scrolling for it.
   */
  useEffect(() => {
    const el = scrollRef.current?.parentElement ?? scrollRef.current;
    if (!el) return;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.closest(".omega-composer")) return;
      pinned.current = true;
      setAtBottom(true);
      delayedTail([0, 150, 350, 600]);
    };
    el.addEventListener("focusin", onFocusIn);
    return () => el.removeEventListener("focusin", onFocusIn);
  }, [delayedTail]);

  /**
   * Keep the reader's place when older history is prepended.
   *
   * Growing the window inserts messages *above* the viewport, which moves
   * everything the reader was looking at down by the height of what arrived.
   * Distance from the bottom is the invariant that survives a prepend, so it
   * is what gets restored — and only while unpinned, since a pinned view
   * wants the bottom rather than its old place.
   */
  const restoreFromBottom = useRef<number | undefined>(undefined);
  const requestOlder = useCallback(() => {
    const el = scrollRef.current;
    if (el && !pinned.current) restoreFromBottom.current = el.scrollHeight - el.scrollTop;
    onLoadOlder?.();
  }, [onLoadOlder]);

  useEffect(() => {
    const target = restoreFromBottom.current;
    if (target === undefined) return;
    restoreFromBottom.current = undefined;

    // Re-applied rather than written once: the prepended page mounts as raw
    // text and grows as markdown and highlighting land, so the height the
    // first frame sees is not the height the reader ends up with. Each pass
    // re-derives the position from the distance that was saved.
    const apply = (): void => {
      const node = scrollRef.current;
      if (!node) return;
      node.scrollTop = Math.max(0, node.scrollHeight - target);
      lastTop.current = node.scrollTop;
    };
    apply();
    const timers = [60, 180, 350, 600].map(delay => window.setTimeout(apply, delay));
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [items.length]);

  /**
   * Pull up past the bottom to reload.
   *
   * The mirror of a browser's pull-to-refresh: this conversation is anchored
   * at its bottom edge, so the end of the content — not the top — is where
   * "there is nothing beyond this" lives, and dragging against that edge is
   * the gesture already in everyone's hands.
   *
   * The listeners are attached by hand because the move handler cancels the
   * touch once the drag is claimed, and React's synthetic touch handlers are
   * passive.
   */
  const pullStart = useRef<number | undefined>(undefined);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !onReload) return;

    const atBottomEdge = (): boolean => el.scrollHeight - el.scrollTop - el.clientHeight <= 1;

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(
        target.closest(".omega-composer") ||
        target.closest("textarea, input, button, select, [contenteditable]"),
      );
    };

    const onStart = (event: TouchEvent): void => {
      if (event.touches.length !== 1 || reloading || !atBottomEdge() || isInteractiveTarget(event.target)) {
        return;
      }
      pullStart.current = event.touches[0]!.clientY;
    };

    const onMove = (event: TouchEvent): void => {
      const start = pullStart.current;
      if (start === undefined) return;
      if (isInteractiveTarget(event.target)) {
        pullStart.current = undefined;
        setPull(0);
        return;
      }
      // Upward drag only, and only while the content is still against the
      // bottom: a downward flick is scrollback and must stay scrollback.
      const dragged = start - event.touches[0]!.clientY;
      if (dragged <= 0 || !atBottomEdge()) {
        pullStart.current = undefined;
        setPull(0);
        return;
      }
      // need real effort, which is what makes the threshold findable.
      const distance = Math.min(PULL_MAX_PX, Math.sqrt(dragged) * 9);
      setPull(distance);
      if (event.cancelable) event.preventDefault();
    };

    const onEnd = (): void => {
      const start = pullStart.current;
      pullStart.current = undefined;
      if (start === undefined) return;
      setPull(current => {
        if (current < PULL_TRIGGER_PX) return 0;
        setReloading(true);
        void Promise.resolve(onReload())
          .catch(() => undefined)
          .then(() => {
            setReloading(false);
            setPull(0);
          });
        // Hold the icon at the threshold while the reload runs.
        return PULL_TRIGGER_PX;
      });
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [onReload, reloading]);

  return (
    <Box style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {onReload ? (
        // Behind the content, at the bottom edge the drag opens up. Muted on
        // purpose: it is an affordance being uncovered, not an alert.
        <Box
          className="omega-pull-indicator"
          style={{ height: pull, opacity: Math.min(1, pull / PULL_TRIGGER_PX) }}
          aria-hidden={pull === 0}
        >
          <IconRefresh
            size={18}
            className={reloading ? "omega-pull-spin" : undefined}
            style={{
              color: "var(--mantine-color-dimmed)",
              // The icon turns with the drag, so the gesture has a readout
              // before it commits; past the threshold it stops turning and
              // holds, which is what says "let go".
              transform: reloading ? undefined : `rotate(${Math.min(pull, PULL_TRIGGER_PX) * 2.8}deg)`,
            }}
          />
        </Box>
      ) : null}
      <Box
        ref={scrollRef}
        className="omega-scroll"
        px="sm"
        pt="sm"
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "scroll",
          overflowX: "hidden",
          transform: pull > 0 ? `translateY(${-pull}px)` : undefined,
          // Snapping back is animated; following a finger is not.
          transition: pullStart.current === undefined ? "transform 180ms ease-out" : undefined,
        }}
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
          <Stack gap="md" pb={16} className="omega-measure">
            {hasOlder && onLoadOlder ? (
              // Anchored above the oldest message rather than triggered by
              // scrolling into it: growing the window moves everything below,
              // and doing that to someone who was only scrolling up is worse
              // than asking.
              <Group justify="center" py="xs">
                <Button
                  size="xs"
                  variant="light"
                  color="plum"
                  loading={loadingOlder}
                  onClick={requestOlder}
                  leftSection={<IconHistory size={14} />}
                >
                  Load 1000 older messages
                </Button>
              </Group>
            ) : null}
            {items.map((item, index) => {
              switch (item.kind) {
                case "message":
                  return (
                    <Message
                      key={item.id}
                      message={item.message}
                      streaming={item.streaming}
                      armedAt={armed?.id === item.id ? armed.offset : undefined}
                      onArm={offset => setArmed({ id: item.id, offset })}
                      onFork={onFork}
                      showThinking={showThinking}
                      showToolCalls={showToolCalls}
                      subagents={subagents}
                      onOpenSubagents={onOpenSubagents}
                    />
                  );
                case "separator":
                  return (
                    <Group key={item.id} gap="sm" align="center" wrap="nowrap" className="omega-separator">
                      <Box style={{ flex: 1, height: 1 }} className="omega-separator-line" />
                      <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                        {item.label}
                      </Text>
                      <Box style={{ flex: 1, height: 1 }} className="omega-separator-line" />
                    </Group>
                  );
                case "working": {
                  const activeCount = (subagents ?? []).filter(s => s.status === "running").length;
                  return (
                    <Group key="working" gap="xs">
                      <Badge
                        color="plum"
                        variant="light"
                        className="omega-pulse"
                        style={{ cursor: onOpenSubagents ? "pointer" : undefined }}
                        onClick={onOpenSubagents}
                        leftSection={activeCount > 0 ? <IconRobot size={14} /> : undefined}
                      >
                        {activeCount > 0
                          ? `working (${activeCount} ${activeCount === 1 ? "sub-agent" : "sub-agents"})`
                          : "working"}
                      </Badge>
                    </Group>
                  );
                }
                case "notice":
                  return (
                    <Alert key={`notice-${index}`} variant="light" color="cyan" title="Notice">
                      {item.notice}
                    </Alert>
                  );
                case "error":
                  return (
                    <Alert
                      key={`error-${index}`}
                      variant="light"
                      color="red"
                      icon={<IconAlertTriangle size={16} />}
                      title="Turn failed"
                    >
                      {item.error}
                    </Alert>
                  );
              }
            })}
          </Stack>
        )}
        {children ? (
          <Box
            style={{
              position: "sticky",
              bottom: 0,
              zIndex: 100,
              pointerEvents: "none",
              paddingTop: "var(--mantine-spacing-sm)",
              paddingBottom: "max(var(--mantine-spacing-sm), env(safe-area-inset-bottom))",
            }}
          >
            <div className="omega-measure" style={{ position: "relative" }}>
              {!atBottom ? (
                <Tooltip label="Scroll to bottom" position="left">
                  <ActionIcon
                    variant="filled"
                    color="plum"
                    size="lg"
                    radius="xl"
                    className="omega-scroll-fab"
                    onClick={() => {
                      pinned.current = true;
                      setAtBottom(true);
                      const el = scrollRef.current;
                      if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                      delayedTail([100, 250]);
                    }}
                    style={{
                      position: "absolute",
                      bottom: "100%",
                      marginBottom: 16,
                      boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
                      zIndex: 10,
                      pointerEvents: "auto",
                    }}
                    aria-label="Scroll to bottom"
                  >
                    <IconArrowBarToDown size={20} />
                  </ActionIcon>
                </Tooltip>
              ) : null}
              <div style={{ pointerEvents: "auto" }}>{children}</div>
            </div>
          </Box>
        ) : null}
      </Box>
      {/* Mobile-only vertically centered user message navigation FABs */}
      <Stack
        gap={8}
        className="omega-mobile-nav-fabs"
        style={{
          position: "fixed",
          top: "50%",
          transform: "translateY(-50%)",
          right: 12,
          zIndex: 90,
          pointerEvents: "auto",
        }}
      >
        <Tooltip label="Previous user message" position="left">
          <ActionIcon
            variant="filled"
            color="plum"
            size="lg"
            radius="xl"
            onClick={() => navigateUserMessage("prev")}
            aria-label="Previous user message"
            style={{
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
            }}
          >
            <IconArrowUpDashed size={20} />
          </ActionIcon>
        </Tooltip>

        <Tooltip label="Next user message" position="left">
          <ActionIcon
            variant="filled"
            color="plum"
            size="lg"
            radius="xl"
            onClick={() => navigateUserMessage("next")}
            aria-label="Next user message"
            style={{
              boxShadow: "0 4px 14px rgba(0, 0, 0, 0.45)",
            }}
          >
            <IconArrowDownDashed size={20} />
          </ActionIcon>
        </Tooltip>
      </Stack>
    </Box>
  );
}
