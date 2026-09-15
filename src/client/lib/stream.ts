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

import type { A2uiMessage } from "../../shared/a2ui.ts";
import type { MessagePart, SubagentTask } from "../api/model.ts";
import { type ClientSurface, reduceA2uiMessage, setPointer } from "./a2ui.ts";
/** A frame as it arrives off the socket. */
interface Frame {
  type: string;
  [field: string]: unknown;
}

/** Connection state, surfaced so the UI can say why nothing is moving. */
export type StreamStatus = "connecting" | "open" | "closed";

/** How often to ping, and the unit the liveness check is measured in. */
const KEEPALIVE_MS = 25_000;

/**
 * Delay before the next connection attempt.
 *
 * The first retry is quick because the overwhelming case is a server that
 * just restarted, but an outage that has already failed several times is not
 * going to be fixed by asking faster — and this runs against a machine on the
 * user's own desk, so hammering it is rude. Capped rather than unbounded, so
 * a tab left overnight is still trying on a sane cadence in the morning
 * instead of having backed off into next week.
 *
 * The jitter matters when the server restarts: every open tab saw the same
 * close at the same instant, and without it they would all retry in lockstep.
 */
function backoffMs(failures: number): number {
  const base = Math.min(1_000 * 1.8 ** failures, 15_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

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
  /**
   * Consecutive failed connection attempts, reset by a successful open.
   *
   * The socket cannot see *why* an upgrade failed — a rejected handshake and
   * a dropped network look identical from here — so this is what lets the
   * shell decide that the session itself is the problem and re-open it.
   */
  failures: number;
  /** Bumped whenever the server says REST state went stale. */
  revision: number;
  /** True while a plan is awaiting review. */
  planAwaiting: boolean;
  /** Force an immediate reconnect attempt. */
  /** Active A2UI surfaces for this session. */
  surfaces: ClientSurface[];
  /** Update a surface's data model locally (e.g. from input components). */
  updateSurfaceData: (surfaceId: string, path: string | undefined, value: unknown) => void;
  /** Active sub-agent tasks spawned in this session. */
  subagents: SubagentTask[];
  /** Force an immediate reconnect attempt. */
  reconnect: () => void;
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
  const [subagents, setSubagents] = useState<SubagentTask[]>([]);
  /** Blocks and tools in arrival order; a ref so deltas do not re-render per token. */
  const blocks = useRef<Block[]>([]);
  const tools = useRef<StreamedTool[]>([]);
  const order = useRef<Array<{ kind: "block" | "tool"; id: string }>>([]);
  /** Incremented on every mutation to publish the refs. */
  /** Active A2UI surfaces. Persist across turns within the session. */
  const surfaces = useRef<Map<string, ClientSurface>>(new Map());
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
  // Mirrored into a ref because the backoff is read inside a socket callback,
  // which closes over whatever the count was when the effect last ran.
  const [failures, setFailures] = useState(0);
  const failureCount = useRef(0);
  useEffect(() => {
    // When switching sessions, clear active surfaces and subagents.
    surfaces.current = new Map();
    setSubagents([]);
    setTick(value => value + 1);
  }, [key]);

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

    /**
     * When the last frame arrived. A socket that has been suspended — laptop
     * lid, NAT timeout, a phone that slept — very often stays `OPEN` with
     * nothing behind it, and no close event ever fires. Silence across two
     * keepalives means it is dead however healthy it claims to be.
     */
    let lastFrame = Date.now();
    let awaitingPong = false;

    const keepalive = window.setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (awaitingPong && Date.now() - lastFrame > KEEPALIVE_MS * 2) {
        // Half-open: force the close the transport never reported, which puts
        // this through the ordinary reconnect path.
        socket.close();
        return;
      }
      awaitingPong = true;
      socket.send("ping");
    }, KEEPALIVE_MS);

    socket.addEventListener("open", () => {
      setStatus("open");
      failureCount.current = 0;
      setFailures(0);
      lastFrame = Date.now();
      awaitingPong = false;
      // Resync on arrival, not on departure: a gap in the stream is exactly
      // when the REST snapshot may have moved on without us. Refetching on
      // every failed retry instead would re-request the whole transcript
      // every backoff tick of an outage.
      stale.current();
    });

    // An unexpected close means the server restarted, the network dropped, or
    // the idle sweep released the session.
    const reconnect = (): void => {
      setStatus("closed");
      if (releasing) return;
      if (retry !== undefined) return;
      failureCount.current += 1;
      setFailures(failureCount.current);
      retry = window.setTimeout(() => setAttempt(value => value + 1), backoffMs(failureCount.current));
    };
    socket.addEventListener("close", reconnect);
    socket.addEventListener("error", reconnect);

    // On mobile or when switching tabs, browsers pause timers and sockets time out.
    // When the user returns, reconnect immediately without waiting for a retry timer.
    const onWake = (): void => {
      if (socket.readyState === WebSocket.OPEN) return;
      releasing = true;
      if (retry !== undefined) window.clearTimeout(retry);
      socket.close();
      // Returning to the tab is a deliberate act, so it skips the backoff
      // rather than inheriting however long the last one had grown to.
      setAttempt(value => value + 1);
    };
    window.addEventListener("focus", onWake);
    window.addEventListener("online", onWake);
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") onWake();
    };
    document.addEventListener("visibilitychange", onVisibility);
    socket.addEventListener("message", event => {
      lastFrame = Date.now();
      awaitingPong = false;
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
          // A failed turn never reaches `agent_end`, so nothing else would
          // refetch the transcript — and the user's own message is in it.
          stale.current();
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
          } else if (name === "omp.a2ui") {
            const msg = frame.value as A2uiMessage;
            if (msg) {
              surfaces.current = reduceA2uiMessage(surfaces.current, msg);
              setTick(current => current + 1);
            }
          } else if (name === "omp.subagents") {
            const val = frame.value as { subagents?: SubagentTask[] } | null;
            if (val?.subagents) {
              setSubagents(val.subagents);
            }
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
      window.removeEventListener("focus", onWake);
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onVisibility);
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

  const reconnectNow = useCallback(() => {
    // An explicit reconnect is a fresh start, not the next rung of a backoff
    // the user never asked to be on.
    failureCount.current = 0;
    setFailures(0);
    setAttempt(value => value + 1);
  }, []);
  const updateSurfaceData = useCallback((surfaceId: string, path: string | undefined, value: unknown) => {
    const surface = surfaces.current.get(surfaceId);
    if (!surface) return;
    setPointer(surface.dataModel, path, value);
    surface.revision += 1;
    setTick(v => v + 1);
  }, []);

  const surfaceList = useMemo<ClientSurface[]>(() => {
    void tick;
    return [...surfaces.current.values()];
  }, [tick]);

  return {
    running,
    parts,
    error,
    notices,
    status,
    failures,
    revision,
    planAwaiting,
    surfaces: surfaceList,
    updateSurfaceData,
    subagents,
    reconnect: reconnectNow,
  };
}
