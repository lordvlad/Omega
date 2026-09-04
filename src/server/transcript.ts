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

import type { MessagePart, TranscriptMessage } from "../shared/model.ts";
import { toolResultText } from "./agui.ts";

/** Flatten a live session's messages for rendering. */
export function flattenMessages(messages: readonly AgentMessage[]): TranscriptMessage[] {
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
      out.push({ id: `user-${index}`, role: "user", timestamp, parts: [{ kind: "text", text }] });
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
        case "thinking":
          if (block.thinking.trim()) parts.push({ kind: "thinking", text: block.thinking });
          break;
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
    if (message.errorMessage) parts.push({ kind: "text", text: `**Error:** ${message.errorMessage}` });
    if (parts.length > 0) {
      out.push({ id: `assistant-${index}`, role: "assistant", timestamp, parts });
    }
  }

  return out;
}
