/**
 * Transcript flattening.
 *
 * The browser renders a list of parts, not omp's message union, so this
 * collapses `AgentMessage[]` into `TranscriptMessage[]`. Tool results are
 * folded into the assistant message that called them: a result is only
 * meaningful next to its call, and keeping them adjacent is what lets the UI
 * render one collapsible block per tool invocation.
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";

import type { MessagePart, TranscriptMessage, TranscriptQuery } from "../shared/model.ts";
import { toolResultText } from "./agui.ts";

/**
 * Entry ids for the messages that have one, keyed by message identity.
 *
 * Keyed by object rather than by position because the two lists are filtered
 * differently: the transcript drops synthetic and empty messages, the entry
 * log does not. Correlating by order would survive most conversations and
 * then silently point one message off in the ones that do not — and a branch
 * taken at the wrong entry truncates the conversation at the wrong place.
 */
export type EntryIds = ReadonlyMap<AgentMessage, string>;

/** Flatten a live session's messages for rendering. */
export function flattenMessages(messages: readonly AgentMessage[], entryIds?: EntryIds): TranscriptMessage[] {
  const out: TranscriptMessage[] = [];
  /** Tool call id → the part awaiting its result. */
  const awaiting = new Map<string, MessagePart>();

  for (const [index, message] of messages.entries()) {
    const timestamp =
      typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : undefined;

    if (message.role === "toolResult") {
      const pending = awaiting.get(message.toolCallId);
      const text = toolResultText(message);
      if (pending) {
        // Attach the outcome to the call that produced it.
        pending.text = text;
        pending.isError = message.isError;
        awaiting.delete(message.toolCallId);
        continue;
      }
      // A result whose call was compacted away still happened; show it alone.
      out.push({
        id: `tool-${message.toolCallId}`,
        role: "toolResult",
        timestamp,
        parts: [
          {
            kind: "toolResult",
            text,
            toolName: message.toolName,
            toolCallId: message.toolCallId,
            isError: message.isError,
          },
        ],
      });
      continue;
    }

    if (message.role === "user" || message.role === "developer") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content.map(part => (part.type === "text" ? part.text : `[${part.type}]`)).join("\n");
      // Steering wrappers and synthetic directives are machinery, not
      // conversation; the plan-approved prompt would otherwise appear as a
      // user message nobody typed.
      if ("synthetic" in message && message.synthetic) continue;
      if (!text.trim()) continue;
      out.push({
        id: `user-${index}`,
        role: "user",
        timestamp,
        parts: [{ kind: "text", text }],
        // `developer` messages fall through this branch too; they are not
        // branchable, and they have no entry of their own to offer.
        entryId: message.role === "user" ? entryIds?.get(message) : undefined,
      });
      continue;
    }

    if (message.role !== "assistant") {
      // Internal metadata messages without display: true should not render in chat
      if ("display" in message && message.display === false) continue;
      const text = "content" in message && typeof message.content === "string" ? message.content : "";
      if (text.trim()) {
        out.push({ id: `custom-${index}`, role: "custom", timestamp, parts: [{ kind: "text", text }] });
      }
      continue;
    }

    const parts: MessagePart[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case "text":
          if (block.text.trim()) parts.push({ kind: "text", text: block.text });
          break;
        case "thinking": {
          const thinkingText = block.thinking.trim();
          if (thinkingText) {
            const prev = parts[parts.length - 1];
            if (prev && prev.kind === "thinking") {
              prev.text = prev.text ? `${prev.text}\n\n${thinkingText}` : thinkingText;
            } else {
              parts.push({ kind: "thinking", text: thinkingText });
            }
          }
          break;
        }
        case "toolCall": {
          let args: string;
          try {
            args = JSON.stringify(block.arguments ?? {}, null, 2);
          } catch {
            // Model-supplied arguments can carry cycles via host objects.
            args = "{}";
          }
          const part: MessagePart = {
            kind: "toolCall",
            text: "",
            toolName: block.name,
            toolCallId: block.id,
            args,
          };
          awaiting.set(block.id, part);
          parts.push(part);
          break;
        }
        default:
          // Images and provider-specific blocks have no text body.
          break;
      }
    }
    // A failure is why the turn stopped, not a paragraph of it. Marking it as
    // its own kind lets the client render the same alert the live stream
    // shows, rather than bold text buried in the reply it never finished.
    if (message.errorMessage) parts.push({ kind: "error", text: message.errorMessage });
    if (parts.length > 0) {
      out.push({ id: `assistant-${index}`, role: "assistant", timestamp, parts });
    }
  }

  return out;
}

/**
 * One entry of the session log, as much of it as this module needs.
 *
 * Structural rather than imported: the transcript only cares that an entry
 * may carry a message and an id.
 */
export interface SessionEntryLike {
  type: string;
  id: string;
  message?: AgentMessage;
}

/**
 * Flatten a conversation, restoring failures the agent no longer holds.
 *
 * A turn that ends in an error is written to the session log as an assistant
 * message carrying `errorMessage` and nothing else. Rebuilding a session from
 * disk drops those: they are not context, so the agent has no use for them,
 * and `agent.state.messages` omits them. The transcript is not context
 * though, it is the record — and dropping them is exactly how a conversation
 * comes back from a reload ending mid-turn with nothing to say about why.
 *
 * So they are spliced back in at the position the log gives them, which keeps
 * a failure attached to the turn that failed rather than stranded at the end
 * of a conversation that continued past it.
 */
export function flattenSession(
  messages: readonly AgentMessage[],
  entries: readonly SessionEntryLike[],
): TranscriptMessage[] {
  const entryIds = new Map<AgentMessage, string>();
  for (const entry of entries) {
    if (entry.type === "message" && entry.message) entryIds.set(entry.message, entry.id);
  }

  const out = flattenMessages(messages, entryIds);

  // Every rendered message carries its source index in its id (`assistant-7`),
  // so a failure can be placed against the message it followed without
  // re-deriving the mapping or assuming the two lists run in step.
  const renderedAt = new Map<number, number>();
  for (const [position, rendered] of out.entries()) {
    const source = Number(rendered.id.slice(rendered.id.lastIndexOf("-") + 1));
    if (Number.isInteger(source)) renderedAt.set(source, position);
  }
  const sourceOf = new Map<AgentMessage, number>();
  for (const [index, message] of messages.entries()) sourceOf.set(message, index);

  /** How many attempts each rendered failure stands for. */
  const repeats = new Map<string, number>();
  let inserted = 0;
  let after = -1;
  for (const entry of entries) {
    const message = entry.type === "message" ? entry.message : undefined;
    if (!message) continue;

    const source = sourceOf.get(message);
    if (source !== undefined) {
      // A tool result folds into the call above it and renders nothing of its
      // own; anything that did render moves the insertion point along.
      const position = renderedAt.get(source);
      if (position !== undefined) after = position + inserted;
      continue;
    }

    if (message.role !== "assistant" || !message.errorMessage) continue;

    // omp retries a failing call before giving up, and each attempt is
    // recorded. Rendering one alert per attempt reads as several failed turns
    // instead of one that was retried, so a repeat of the error immediately
    // above is folded into it and counted.
    const previous = out[after];
    const repeated =
      previous?.id.startsWith("failure-") === true &&
      previous.parts.length === 1 &&
      previous.parts[0]?.kind === "error" &&
      stripCount(previous.parts[0].text) === message.errorMessage;
    if (repeated && previous?.parts[0]) {
      repeats.set(previous.id, (repeats.get(previous.id) ?? 1) + 1);
      previous.parts[0].text = `${message.errorMessage} (×${repeats.get(previous.id)})`;
      continue;
    }

    const timestamp =
      typeof message.timestamp === "number" ? new Date(message.timestamp).toISOString() : undefined;
    out.splice(after + 1, 0, {
      id: `failure-${entry.id}`,
      role: "assistant",
      timestamp,
      parts: [{ kind: "error", text: message.errorMessage }],
    });
    inserted += 1;
    after += 1;
  }

  return out;
}

/** The error text without the repeat count this module may have appended. */
function stripCount(text: string): string {
  return text.replace(/ \(×\d+\)$/u, "");
}

/** Default page size: what one unvirtualised transcript renders comfortably. */
const DEFAULT_LIMIT = 1000;

/** Largest window a client may ask for, so one request cannot pin the process. */
const MAX_LIMIT = 20_000;

/** One window of a transcript: its newest messages, and whether older exist. */
export interface TranscriptWindow {
  messages: TranscriptMessage[];
  hasMore: boolean;
}

/**
 * Drop the parts this client will not draw, then merge what that leaves
 * adjacent.
 *
 * Filtering here rather than in the browser is the point: hidden thinking and
 * tool output are most of a long session's bytes. Hiding tool parts can also
 * leave two thinking blocks next to each other, and two boxes for one
 * uninterrupted train of thought is an artefact of the parts list, not
 * something that happened — so they are folded into one.
 */
function project(message: TranscriptMessage, thinking: boolean, toolCalls: boolean): TranscriptMessage {
  const parts: MessagePart[] = [];
  for (const part of message.parts) {
    if (part.kind === "thinking" && !thinking) continue;
    if ((part.kind === "toolCall" || part.kind === "toolResult") && !toolCalls) continue;
    const previous = parts[parts.length - 1];
    if (part.kind === "thinking" && previous?.kind === "thinking") {
      previous.text = `${previous.text}\n\n${part.text}`;
      continue;
    }
    parts.push({ ...part });
  }
  return { ...message, parts };
}

/**
 * Take the newest `limit` messages.
 *
 * The newest messages are the ones worth showing, so the window is measured
 * backwards from the end and grown when the reader asks for more history. A
 * message left with no parts by filtering is dropped rather than rendered as
 * an empty row, and it does not consume a slot in the window either.
 */
export function pageTranscript(
  all: readonly TranscriptMessage[],
  query: TranscriptQuery | undefined,
): TranscriptWindow {
  const thinking = query?.thinking !== false;
  const toolCalls = query?.toolCalls !== false;
  const requested = query?.limit ?? DEFAULT_LIMIT;
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.trunc(requested) || DEFAULT_LIMIT));

  const visible = all
    .map(message => project(message, thinking, toolCalls))
    .filter(message => message.parts.length > 0);

  const start = Math.max(0, visible.length - limit);
  return { messages: visible.slice(start), hasMore: start > 0 };
}
