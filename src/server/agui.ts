/**
 * Translation from omp's `AgentSessionEvent` stream to AG-UI stream chunks.
 *
 * The browser speaks the AG-UI protocol that `@tanstack/ai` defines, so the
 * client never parses omp's internal event union. Two details drive the
 * mapping:
 *
 * - Tool events come from `tool_execution_*`, not the `toolcall_*` deltas on
 *   `message_update`. Only the former carry a `toolCallId`, and AG-UI keys
 *   every tool frame by it; the delta events identify a block by
 *   `contentIndex` alone, which cannot be correlated with a result.
 * - A `messageId` is `<runId>-<contentIndex>`. One assistant turn interleaves
 *   several text and thinking blocks around tool calls, and AG-UI treats each
 *   as its own message, so the content index is what keeps them apart.
 */
import { EventType } from "@tanstack/ai/client";

/** An AG-UI frame, as it goes over the wire. */
export type AguiFrame = Record<string, unknown> & { type: string };

/** omp-specific frames ride `CUSTOM`, keyed by `name`. */
export type OmpCustomName =
  | "omp.state"
  | "omp.plan"
  | "omp.notice"
  | "omp.todo"
  | "omp.tool_update"
  | "omp.a2ui";

/** Build a `CUSTOM` frame carrying omp state the AG-UI vocabulary has no slot for. */
export function custom(name: OmpCustomName, value: unknown): AguiFrame {
  return { type: EventType.CUSTOM, name, value };
}

/** Flatten an omp tool result into display text. */
export function toolResultText(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (typeof result !== "object") return String(result);

  if ("content" in result && Array.isArray(result.content)) {
    return result.content
      .map(part => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const kind = "type" in part && typeof part.type === "string" ? part.type : "";
        if (kind === "text" && "text" in part && typeof part.text === "string") return part.text;
        // Non-text parts (images, resources) have no textual body; name the
        // kind so the transcript shows that something was returned.
        return kind ? `[${kind}]` : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if ("text" in result && typeof result.text === "string") return result.text;
  return JSON.stringify(result);
}

/**
 * Per-session translator. Holds only the run counter and the set of blocks it
 * has opened, so it can close them if a turn ends mid-block.
 */
export class AguiTranslator {
  readonly #threadId: string;
  #runSeq = 0;
  #runId: string;
  /** Content indices with an open `TEXT_MESSAGE_START`. */
  readonly #openText = new Set<number>();
  /** Content indices with an open `THINKING_TEXT_MESSAGE_START`. */
  readonly #openThinking = new Set<number>();

  constructor(threadId: string) {
    this.#threadId = threadId;
    this.#runId = `${threadId}-0`;
  }

  get runId(): string {
    return this.#runId;
  }

  #messageId(contentIndex: number): string {
    return `${this.#runId}-${contentIndex}`;
  }

  /**
   * Convert one omp event into zero or more AG-UI frames.
   *
   * Unmapped omp events return an empty array rather than a `RAW` passthrough:
   * a frame the client cannot act on is noise in the transcript reducer.
   */
  translate(event: { type: string } & Record<string, any>): AguiFrame[] {
    switch (event.type) {
      case "agent_start": {
        this.#runSeq += 1;
        this.#runId = `${this.#threadId}-${this.#runSeq}`;
        return [{ type: EventType.RUN_STARTED, threadId: this.#threadId, runId: this.#runId }];
      }
      case "agent_end": {
        // `isTerminal: false` means maintenance or async delivery has already
        // scheduled more work, so the run has not settled and the composer
        // must stay busy.
        if (event.isTerminal === false) return [];
        const frames = this.#closeOpenBlocks();
        frames.push({ type: EventType.RUN_FINISHED, threadId: this.#threadId, runId: this.#runId });
        return frames;
      }
      case "message_update":
        return this.#translateDelta(event.assistantMessageEvent);
      case "tool_execution_start": {
        let args: string;
        try {
          args = JSON.stringify(event.args ?? {});
        } catch {
          // Tool arguments are model-supplied and can carry cycles.
          args = "{}";
        }
        return [
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: event.toolCallId,
            toolCallName: event.toolName,
            toolName: event.toolName,
          },
          { type: EventType.TOOL_CALL_ARGS, toolCallId: event.toolCallId, delta: args },
          { type: EventType.TOOL_CALL_END, toolCallId: event.toolCallId, input: event.args },
        ];
      }
      case "tool_execution_update":
        return [
          custom("omp.tool_update", {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            text: toolResultText(event.partialResult),
          }),
        ];
      case "tool_execution_end":
        return [
          {
            type: EventType.TOOL_CALL_RESULT,
            messageId: `${event.toolCallId}-result`,
            toolCallId: event.toolCallId,
            content: toolResultText(event.result),
            isError: event.isError === true,
          },
        ];
      case "notice":
        return [custom("omp.notice", { level: event.level, message: event.message })];
      case "todo_reminder":
      case "todo_auto_clear":
        return [custom("omp.todo", event)];
      case "model_changed":
      case "thinking_level_changed":
        return [custom("omp.state", { reason: event.type })];
      default:
        return [];
    }
  }

  /** Close whatever blocks are open, so an abort cannot strand them. */
  #closeOpenBlocks(): AguiFrame[] {
    const frames: AguiFrame[] = [];
    for (const index of this.#openThinking) {
      frames.push({ type: EventType.THINKING_TEXT_MESSAGE_END, messageId: this.#messageId(index) });
    }
    this.#openThinking.clear();
    for (const index of this.#openText) {
      frames.push({ type: EventType.TEXT_MESSAGE_END, messageId: this.#messageId(index) });
    }
    this.#openText.clear();
    return frames;
  }

  #translateDelta(delta: { type: string } & Record<string, any>): AguiFrame[] {
    if (!delta) return [];
    const index: number = typeof delta.contentIndex === "number" ? delta.contentIndex : 0;
    const messageId = this.#messageId(index);
    switch (delta.type) {
      case "text_start":
        this.#openText.add(index);
        return [{ type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" }];
      case "text_delta":
        // A provider that streams content without a preceding start event
        // would otherwise drop its first tokens on the client.
        return this.#ensureOpen(this.#openText, index, EventType.TEXT_MESSAGE_START, messageId).concat({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: delta.delta,
        });
      case "text_end":
        this.#openText.delete(index);
        return [{ type: EventType.TEXT_MESSAGE_END, messageId }];
      case "thinking_start":
        this.#openThinking.add(index);
        return [{ type: EventType.THINKING_TEXT_MESSAGE_START, messageId }];
      case "thinking_delta":
        return this.#ensureOpen(
          this.#openThinking,
          index,
          EventType.THINKING_TEXT_MESSAGE_START,
          messageId,
        ).concat({
          type: EventType.THINKING_TEXT_MESSAGE_CONTENT,
          messageId,
          delta: delta.delta,
        });
      case "thinking_end":
        this.#openThinking.delete(index);
        return [{ type: EventType.THINKING_TEXT_MESSAGE_END, messageId }];
      case "error":
        return [
          ...this.#closeOpenBlocks(),
          {
            type: EventType.RUN_ERROR,
            message: delta.reason === "aborted" ? "Turn aborted." : "The model returned an error.",
          },
        ];
      default:
        return [];
    }
  }

  /** Emit the opening frame for a block whose start event never arrived. */
  #ensureOpen(open: Set<number>, index: number, startType: string, messageId: string): AguiFrame[] {
    if (open.has(index)) return [];
    open.add(index);
    return [{ type: startType, messageId, role: "assistant" }];
  }
}
