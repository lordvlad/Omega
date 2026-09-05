/**
 * The live turn: an AG-UI socket reduced into renderable parts.
 *
 * The server sends AG-UI frames as `@tanstack/ai` defines them, so this is the
 * client half of that protocol. Only the *in-flight* turn lives here; settled
 * history comes from `GET /api/sessions/:key/transcript`, which is the
 * authoritative record. Keeping the two apart avoids the usual streaming-chat
 * bug where a reconnect duplicates a finished message.
 */
import { EventType } from "@tanstack/ai/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MessagePart } from "../api/model.ts";

/** A frame as it arrives off the socket. */
interface Frame {
  type: string;
  [field: string]: unknown;
}

/** Connection state, surfaced so the UI can say why nothing is moving. */
export type StreamStatus = "connecting" | "open" | "closed";

/** A streaming block, keyed by the AG-UI `messageId` that owns it. */
interface Block {
  id: string;
  kind: "text" | "thinking";
  text: string;
}

/** A tool call observed on the stream, with its result once it lands. */
interface StreamedTool {
  id: string;
  toolName: string;
  args: string;
  result?: string;
  isError?: boolean;
  done: boolean;
}

/** Everything the chat pane needs about the turn currently in flight. */
export interface LiveTurn {
  /** True between `RUN_STARTED` and `RUN_FINISHED`. */
  running: boolean;
  /** Ordered text/thinking blocks and tool calls of the running turn. */
  parts: MessagePart[];
  /** Last `RUN_ERROR` message, cleared when a new run starts. */
  error?: string;
  /** Notices omp emitted during the turn. */
  notices: string[];
  status: StreamStatus;
  /** Bumped whenever the server says REST state went stale. */
  revision: number;
  /** True while a plan is awaiting review. */
  planAwaiting: boolean;
}

/**
 * Subscribe to a session's AG-UI stream.
 *
 * `onStale` fires when the server reports that snapshot state changed, which
 * is the signal to refetch the transcript and session state rather than trying
 * to mirror every field in the reducer.
 */
export function useLiveTurn(key: string | undefined, onStale: () => void): LiveTurn {
  const [status, setStatus] = useState<StreamStatus>("closed");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [notices, setNotices] = useState<string[]>([]);
  const [planAwaiting, setPlanAwaiting] = useState(false);
  const [revision, setRevision] = useState(0);
  /** Blocks and tools in arrival order; a ref so deltas do not re-render per token. */
  const blocks = useRef<Block[]>([]);
  const tools = useRef<StreamedTool[]>([]);
  const order = useRef<Array<{ kind: "block" | "tool"; id: string }>>([]);
  /** Incremented on every mutation to publish the refs. */
  const [tick, setTick] = useState(0);

  const stale = useRef(onStale);
  stale.current = onStale;

  const reset = useCallback(() => {
    blocks.current = [];
    tools.current = [];
    order.current = [];
    setTick(value => value + 1);
  }, []);

  // Bumped to force a fresh socket after an unexpected close.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!key) {
      setStatus("closed");
      return;
    }
    reset();
    setStatus("connecting");

    /** True once this effect is tearing down, so its close is expected. */
    let releasing = false;
    let retry: number | undefined;

    const url = new URL(`/ws/${encodeURIComponent(key)}`, window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);

    // The phone suspends the socket when the screen locks; a periodic ping
    // keeps the server's idle timer from closing a session mid-turn.
    const keepalive = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send("ping");
    }, 25_000);

    socket.addEventListener("open", () => setStatus("open"));
    // An unexpected close means the server restarted, the network dropped, or
    // the idle sweep released the session. Refetch REST state — a released
    // session 404s, which is what drives the reopen-from-URL path — and then
    // dial back in so a recovered session streams again without a reload.
    const reconnect = (): void => {
      setStatus("closed");
      if (releasing) return;
      stale.current();
      retry = window.setTimeout(() => setAttempt(value => value + 1), 2_000);
    };
    socket.addEventListener("close", reconnect);
    socket.addEventListener("error", reconnect);

    socket.addEventListener("message", event => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(event.data));
      } catch {
        return;
      }
      apply(frame);
    });

    /** Find or append a streaming block. */
    const block = (id: string, kind: Block["kind"]): Block => {
      const found = blocks.current.find(candidate => candidate.id === id);
      if (found) return found;
      const created: Block = { id, kind, text: "" };
      blocks.current.push(created);
      order.current.push({ kind: "block", id });
      return created;
    };

    function apply(frame: Frame): void {
      switch (frame.type) {
        case EventType.RUN_STARTED:
          reset();
          setError(undefined);
          setNotices([]);
          setRunning(true);
          break;
        case EventType.RUN_FINISHED:
          setRunning(false);
          // History is now durable, so drop the streamed copy and let the
          // transcript query own it. Clearing here is what prevents the
          // turn being rendered twice.
          reset();
          stale.current();
          break;
        case EventType.RUN_ERROR:
          setRunning(false);
          setError(typeof frame.message === "string" ? frame.message : "The turn failed.");
          break;

        case EventType.TEXT_MESSAGE_START:
          block(String(frame.messageId), "text");
          setTick(value => value + 1);
          break;
        case EventType.TEXT_MESSAGE_CONTENT:
          block(String(frame.messageId), "text").text += String(frame.delta ?? "");
          setTick(value => value + 1);
          break;
        case EventType.THINKING_TEXT_MESSAGE_START:
          block(String(frame.messageId), "thinking");
          setTick(value => value + 1);
          break;
        case EventType.THINKING_TEXT_MESSAGE_CONTENT:
          block(String(frame.messageId), "thinking").text += String(frame.delta ?? "");
          setTick(value => value + 1);
          break;

        case EventType.TOOL_CALL_START: {
          const id = String(frame.toolCallId);
          if (!tools.current.some(tool => tool.id === id)) {
            tools.current.push({
              id,
              toolName: String(frame.toolCallName ?? frame.toolName ?? "tool"),
              args: "",
              done: false,
            });
            order.current.push({ kind: "tool", id });
          }
          setTick(value => value + 1);
          break;
        }
        case EventType.TOOL_CALL_ARGS: {
          const tool = tools.current.find(candidate => candidate.id === String(frame.toolCallId));
          if (tool) tool.args += String(frame.delta ?? "");
          setTick(value => value + 1);
          break;
        }
        case EventType.TOOL_CALL_RESULT: {
          const tool = tools.current.find(candidate => candidate.id === String(frame.toolCallId));
          if (tool) {
            tool.result = String(frame.content ?? "");
            tool.isError = frame.isError === true;
            tool.done = true;
          }
          setTick(value => value + 1);
          break;
        }

        case EventType.CUSTOM: {
          const name = String(frame.name ?? "");
          if (name === "omp.state") {
            setRevision(value => value + 1);
            stale.current();
          } else if (name === "omp.plan") {
            const value = frame.value as { awaitingApproval?: boolean } | null;
            setPlanAwaiting(value?.awaitingApproval === true);
            setRevision(current => current + 1);
            stale.current();
          } else if (name === "omp.notice") {
            const value = frame.value as { message?: string } | null;
            if (value?.message) setNotices(current => [...current.slice(-4), value.message as string]);
          } else if (name === "omp.tool_update") {
            const value = frame.value as { toolCallId?: string; text?: string } | null;
            const tool = tools.current.find(candidate => candidate.id === String(value?.toolCallId));
            if (tool && value?.text) tool.result = value.text;
            setTick(current => current + 1);
          }
          break;
        }
        default:
          break;
      }
    }

    return () => {
      releasing = true;
      if (retry !== undefined) window.clearTimeout(retry);
      window.clearInterval(keepalive);
      socket.close();
    };
  }, [key, reset, attempt]);

  const parts = useMemo<MessagePart[]>(() => {
    // `tick` is the publication signal for the mutable refs above.
    void tick;
    return order.current.flatMap<MessagePart>(entry => {
      if (entry.kind === "block") {
        const found = blocks.current.find(candidate => candidate.id === entry.id);
        if (!found || !found.text) return [];
        return [{ kind: found.kind, text: found.text }];
      }
      const tool = tools.current.find(candidate => candidate.id === entry.id);
      if (!tool) return [];
      return [
        {
          kind: "toolCall",
          text: tool.result ?? "",
          toolName: tool.toolName,
          toolCallId: tool.id,
          args: tool.args,
          isError: tool.isError,
        },
      ];
    });
  }, [tick]);

  return { running, parts, error, notices, status, revision, planAwaiting };
}
