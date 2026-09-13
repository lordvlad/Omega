import * as fs from "node:fs";

/**
 * The live-session registry.
 *
 * omp is embedded in-process through its SDK rather than driven as an
 * `omp --mode rpc` child, because plan mode's approval handler is only
 * installable in-process: `setPlanProposalHandler` is an `AgentSession`
 * method, and the RPC transport exposes no equivalent frame. A subprocess
 * host therefore cannot implement the plan review this UI is required to
 * offer, so the SDK is the only surface that can.
 *
 * One `AgentSession` is held per session UUID. Auth, models and settings are
 * process-wide and shared, so opening a second session does not re-scan the
 * model catalogue.
 */
import type { Model } from "@oh-my-pi/pi-ai";
import {
  type AgentSession,
  type AuthStorage,
  createAgentSession,
  discoverAuthStorage,
  ModelRegistry,
  SessionManager,
  Settings,
} from "@oh-my-pi/pi-coding-agent";

import type { LiveState, ModelOption, PlanState, ThinkingLevel } from "../shared/model.ts";
import { type AguiFrame, AguiTranslator, custom } from "./agui.ts";

/** Frames retained per session so a reconnecting browser can catch up. */
const REPLAY_LIMIT = 2000;

/** Role order the plan actions panel offers, matching omp's own tier order. */
const PLAN_TIER_ORDER = ["smol", "default", "slow"] as const;

/** A subscriber to one session's frame stream. */
export type FrameSink = (frame: AguiFrame) => void;

/** The plan proposal omp is currently waiting on, if any. */
interface PendingPlan {
  planFilePath: string;
  title: string;
  /** Resolves once the user picks an action, releasing the agent's turn. */
  resolve: () => void;
}

/** One live agent session plus everything the web layer wraps around it. */
export class LiveSession {
  #key: string;
  readonly session: AgentSession;
  readonly manager: SessionManager;
  #translator: AguiTranslator;
  readonly #sinks = new Set<FrameSink>();
  readonly #closeListeners = new Set<() => void>();
  readonly #replay: AguiFrame[] = [];
  #pendingPlan: PendingPlan | undefined;
  #unsubscribe: (() => void) | undefined;
  /** Epoch ms of the last user or agent message. Drives idle eviction. */
  #lastActivityAt = Date.now();
  /** Whether the previous sweep sample saw work in flight. */
  #wasBusy = false;
  /** Why the last turn stopped, for a page that reloaded after it did. */
  #lastError: string | undefined;

  constructor(key: string, session: AgentSession, manager: SessionManager) {
    this.#key = key;
    this.session = session;
    this.manager = manager;
    this.#translator = new AguiTranslator(key);
  }

  /** omp session UUID this live agent is registered under. */
  get key(): string {
    return this.#key;
  }

  /**
   * Adopt the session id omp minted for a fork or a branch.
   *
   * `fork()` and `branch()` move this agent onto a new session file with a new
   * id, so the key every URL carries has to move with it. The replay buffer
   * and the translator describe the transcript just left behind, so both are
   * reset: replaying those frames into the branched conversation would render
   * a turn that is no longer part of it.
   */
  adoptKey(next: string): void {
    this.#key = next;
    this.#translator = new AguiTranslator(next);
    this.#replay.length = 0;
  }

  /**
   * Mark the session as active.
   *
   * A browser attaching or detaching deliberately does NOT count: a phone
   * that locks its screen must not shorten the session's life, and a tab left
   * open for a week must not extend it. Only real conversation does.
   */
  touch(): void {
    this.#lastActivityAt = Date.now();
  }

  /** Milliseconds since the last user or agent message. */
  idleFor(now: number = Date.now()): number {
    return now - this.#lastActivityAt;
  }

  /** Begin forwarding omp events as AG-UI frames. */
  start(): void {
    this.#unsubscribe = this.session.subscribe(event => {
      // Every session event is the agent doing something — a message delta, a
      // tool call, a turn boundary — so any of them resets the idle clock and
      // a long tool-heavy turn is never evicted mid-flight.
      this.touch();
      // A new turn supersedes the last failure; keeping it would caption a
      // running turn with the reason the previous one stopped.
      if (event.type === "agent_start") this.#lastError = undefined;
      for (const frame of this.#translator.translate(event)) this.#emit(frame);
      // A settled turn changes model/queue/context/plan state that the REST
      // snapshot owns; tell the client to refetch rather than duplicating
      // every field in the stream.
      if (event.type === "agent_end" && event.isTerminal !== false) {
        this.#emit(custom("omp.state", { reason: "agent_end" }));
      }
    });
  }

  #emit(frame: AguiFrame): void {
    this.#replay.push(frame);
    if (this.#replay.length > REPLAY_LIMIT) this.#replay.splice(0, this.#replay.length - REPLAY_LIMIT);
    for (const sink of this.#sinks) sink(frame);
  }

  /**
   * Push an out-of-band frame, e.g. a plan proposal.
   *
   * A failure is also remembered, not just broadcast: the socket delivers it
   * once, and a reloaded page was not there to hear it.
   */
  emitCustom(frame: AguiFrame): void {
    if (frame.type === "RUN_ERROR") {
      const message = (frame as { message?: unknown }).message;
      this.#lastError = typeof message === "string" ? message : "The turn failed.";
    }
    this.#emit(frame);
  }

  /** Attach a sink and replay what it missed. Returns the detach function. */
  subscribe(sink: FrameSink): () => void {
    for (const frame of this.#replay) sink(frame);
    this.#sinks.add(sink);
    return () => {
      this.#sinks.delete(sink);
    };
  }

  /**
   * Register a listener for this session being torn down, so an attached
   * socket can be closed instead of left pointing at a disposed agent.
   */
  onClosed(listener: () => void): () => void {
    this.#closeListeners.add(listener);
    return () => {
      this.#closeListeners.delete(listener);
    };
  }

  get pendingPlan(): PendingPlan | undefined {
    return this.#pendingPlan;
  }

  /**
   * Whether the agent is doing work that eviction would destroy.
   *
   * "Idle" has to mean the *agent* is idle, not that the user is. Those come
   * apart exactly when it matters most: you send a long job, lock your phone,
   * and the only party still working is the one this timer would kill.
   *
   * `isStreaming` alone is not that question. omp runs bash and eval kernels
   * outside the model's stream — its own boundary operations guard on
   * `isStreaming || isBashRunning || isEvalRunning` for exactly that reason —
   * so a shell command or a REPL can still be running with nothing streaming.
   * Disposing then does not merely disconnect a browser: it kills the child
   * processes, MCP connections and eval kernels the session owns, losing work
   * that reconnecting cannot recover.
   *
   * Only signals that clear on their own belong here, because this predicate
   * holds the idle clock open. A running process ends; a *pending* one does
   * not. `hasPendingBashMessages`, `hasPendingPythonMessages` and
   * `queuedMessageCount` all stay set until some future prompt consumes them
   * — `queuedMessageCount` counts next-turn messages that may never have a
   * next turn — so treating them as work in flight would not protect a job,
   * it would make the session immortal and defeat the sweep entirely.
   *
   * `pendingPlan` is the deliberate exception, and predates this: a plan
   * awaiting review is holding a turn open by design, and the agent is parked
   * inside it rather than finished.
   */
  get busy(): boolean {
    const session = this.session;
    return (
      session.isStreaming || session.isBashRunning || session.isEvalRunning || this.#pendingPlan !== undefined
    );
  }

  /**
   * Sample busyness for the idle sweep, keeping the idle clock honest.
   *
   * Sampling rather than reading `busy` directly because the sweep needs the
   * *edge*, not just the level. While work runs the clock is held at now, so
   * a job cannot age into eviction while it is the reason nobody is idle. On
   * the first sample after it finishes the clock restarts, so the window is
   * measured from the end of the work rather than from the last sweep that
   * happened to observe it — otherwise a job ending just after a sweep gets
   * an idle window one sweep-interval short of the configured one.
   */
  sampleBusy(): boolean {
    const busy = this.busy;
    if (busy || this.#wasBusy) this.touch();
    this.#wasBusy = busy;
    return busy;
  }

  /**
   * Install the plan-proposal handler, so `xd://propose` reaches this UI.
   *
   * The handler resolves only once the user picks an action. That is what
   * holds the agent at the review instead of letting it continue past a plan
   * nobody approved, and it mirrors what omp's interactive mode does with its
   * approval popup.
   */
  armPlanProposals(): void {
    this.session.setPlanProposalHandler(async title => {
      const prepared = await this.session.preparePlanForReview(title);
      const details = prepared.details;
      const planFilePath = details?.planFilePath ?? this.session.getPlanReferencePath();
      const resolvedTitle = details?.title ?? title;

      // Keep plan-mode state pointing at the artifact actually under review;
      // `resolveApprovedPlan` may have found a newer draft than the path in
      // state, and the next planning turn reads that state.
      const state = this.session.getPlanModeState();
      if (state?.enabled && state.planFilePath !== planFilePath) {
        this.session.setPlanModeState({ ...state, planFilePath });
        this.manager.appendModeChange("plan", { planFilePath });
      }

      await new Promise<void>(resolve => {
        this.#pendingPlan = { planFilePath, title: resolvedTitle, resolve };
        this.emitCustom(custom("omp.plan", { awaitingApproval: true, planFilePath, title: resolvedTitle }));
      });
      return prepared;
    });
  }

  /** Release a pending plan review once its action has been applied. */
  settlePlan(): void {
    const pending = this.#pendingPlan;
    this.#pendingPlan = undefined;
    pending?.resolve();
  }

  /** Current plan-mode state for the REST snapshot. */
  planState(): PlanState | undefined {
    const state = this.session.getPlanModeState();
    if (!state?.enabled) return undefined;
    return {
      enabled: true,
      planFilePath: this.#pendingPlan?.planFilePath ?? state.planFilePath,
      awaitingApproval: this.#pendingPlan !== undefined,
      title: this.#pendingPlan?.title,
    };
  }

  /** The snapshot every session route returns. */
  state(): LiveState {
    const model = this.session.model;
    const usage = this.session.getContextUsage();
    return {
      key: this.key,
      sessionFile: this.session.sessionFile ?? "",
      cwd: this.manager.getCwd(),
      title: this.manager.getSessionName() || undefined,
      model: model ? `${model.provider}/${model.id}` : "",
      modelName: model?.name ?? "no model",
      thinkingLevel: (this.session.thinkingLevel ?? "off") as ThinkingLevel,
      streaming: this.session.isStreaming,
      queued: this.session.queuedMessageCount,
      contextUsage: usage
        ? { tokens: usage.tokens, contextWindow: usage.contextWindow, percent: usage.percent }
        : undefined,
      plan: this.planState(),
      todos: this.session.getTodoPhases().map(phase => ({
        name: phase.name,
        tasks: phase.tasks.map(task => ({
          content: task.content,
          status: task.status,
          blocker: task.blocker,
        })),
      })),
      lastError: this.#lastError,
    };
  }

  /** Role tiers the approved plan can be executed with. */
  tiers(): Array<{ role: string; ref: string; name: string }> {
    const cycle = this.session.getRoleModelCycle(PLAN_TIER_ORDER);
    if (!cycle) return [];
    return cycle.models.map(entry => ({
      role: entry.role,
      ref: `${entry.model.provider}/${entry.model.id}`,
      name: entry.model.name || entry.model.id,
    }));
  }

  async dispose(): Promise<void> {
    this.#unsubscribe?.();
    this.session.setPlanProposalHandler(null);
    this.settlePlan();
    // Tell attached browsers before the agent goes away, so a socket is
    // closed deliberately rather than left streaming from a disposed session.
    for (const listener of this.#closeListeners) listener();
    this.#closeListeners.clear();
    this.#sinks.clear();
    this.session.beginDispose();
    await this.session.dispose();
  }
}

/**
 * How long a session may sit without a user or agent message before it is
 * disposed, in minutes. `OMEGA_IDLE_MINUTES=0` keeps sessions forever.
 *
 * A browser disconnect deliberately does not end a session — closing a laptop
 * or locking a phone must not kill a running turn — so this timer is the only
 * thing that reclaims an abandoned agent and the child processes, MCP
 * connections and eval kernels it owns.
 */
const IDLE_MINUTES = Number(process.env.OMEGA_IDLE_MINUTES ?? 15);

/**
 * Longest gap between idle sweeps. A short idle window sweeps proportionally
 * more often so the deadline is honoured rather than rounded up to a minute.
 */
const MAX_SWEEP_INTERVAL_MS = 60_000;

/** Process-wide singletons plus the live session table. */
export class Registry {
  readonly #sessions = new Map<string, LiveSession>();
  #shared: Promise<SharedServices> | undefined;
  #sweeper: ReturnType<typeof setInterval> | undefined;
  /** Called with the key and idle minutes whenever a session is reclaimed. */
  #onEvict: ((key: string, idleMinutes: number) => void) | undefined;

  /**
   * Start the idle sweep. One timer serves every session, so an idle process
   * wakes on a fixed cadence rather than once per conversation.
   */
  startSweeping(onEvict: (key: string, idleMinutes: number) => void): void {
    this.#onEvict = onEvict;
    if (IDLE_MINUTES <= 0 || this.#sweeper) return;
    const limitMs = IDLE_MINUTES * 60_000;
    this.#sweeper = setInterval(
      () => {
        const now = Date.now();
        for (const [key, live] of [...this.#sessions]) {
          // A working agent is not an idle session, whatever the user is
          // doing. `sampleBusy` both answers that and keeps the idle clock
          // pinned to the work, so a job is neither evicted while it runs nor
          // evicted the instant it finishes.
          if (live.sampleBusy()) continue;
          const idle = live.idleFor(now);
          if (idle < limitMs) continue;
          this.#sessions.delete(key);
          this.#onEvict?.(key, Math.round(idle / 60_000));
          void live.dispose().catch(() => undefined);
        }
      },
      Math.max(1_000, Math.min(MAX_SWEEP_INTERVAL_MS, limitMs / 2)),
    );
    // The sweep must never be the reason the process stays alive.
    this.#sweeper.unref?.();
  }

  /** Configured idle window in minutes; `0` means sessions are never evicted. */
  get idleMinutes(): number {
    return IDLE_MINUTES;
  }

  /** Auth, model registry and settings, resolved once and reused. */
  #services(): Promise<SharedServices> {
    this.#shared ??= (async () => {
      const authStorage = await discoverAuthStorage();
      const modelRegistry = new ModelRegistry(authStorage);
      await modelRegistry.refresh();
      const settings = await Settings.init({ cwd: process.cwd() });
      return { authStorage, modelRegistry, settings };
    })();
    return this.#shared;
  }

  isLive(sessionId: string): boolean {
    return this.#sessions.has(sessionId);
  }

  get(key: string): LiveSession | undefined {
    return this.#sessions.get(key);
  }

  async listModels(): Promise<ModelOption[]> {
    const { modelRegistry } = await this.#services();
    return modelRegistry.getAvailable().map(model => ({
      provider: model.provider,
      id: model.id,
      name: model.name || model.id,
      ref: `${model.provider}/${model.id}`,
      reasoning: model.reasoning === true,
      contextWindow: model.contextWindow ?? 0,
    }));
  }

  /** Resolve a `provider/id` reference against the authenticated catalogue. */
  async resolveModel(ref: string): Promise<Model> {
    const { modelRegistry } = await this.#services();
    const match = modelRegistry.getAvailable().find(model => `${model.provider}/${model.id}` === ref);
    if (!match) throw new Error(`Model not available: ${ref}`);
    return match;
  }

  /**
   * Open an existing session file, or create one in `cwd`.
   *
   * Opening a session that is already live returns the existing agent: a
   * second `AgentSession` over one file would give two writers to the same
   * append-only log.
   */
  async open(options: { sessionPath?: string; cwd?: string }): Promise<LiveSession> {
    if (options.sessionPath) {
      for (const live of this.#sessions.values()) {
        if (live.session.sessionFile === options.sessionPath) return live;
      }
    }

    if (!options.sessionPath && !options.cwd) {
      throw new Error("cwd is required when sessionPath is omitted");
    }
    const { authStorage, modelRegistry, settings } = await this.#services();
    const manager = options.sessionPath
      ? await SessionManager.open(options.sessionPath)
      : SessionManager.create(options.cwd as string);

    const { session } = await createAgentSession({
      authStorage,
      modelRegistry,
      settings,
      sessionManager: manager,
      cwd: manager.getCwd(),
      // The browser is the UI, but omp's `hasUI` gates terminal-only
      // surfaces (LSP warmup, title bar). Leave it false and drive the
      // surfaces this host actually implements explicitly.
      hasUI: false,
    });

    // The key must be the id `SessionManager.listAll()` reports as
    // `SessionSummary.id` — what the client matches on for stale-URL recovery
    // and what a fork or a branch mints. `session.sessionId` prefers a
    // provider-session override, so it is not that id.
    const key = manager.getSessionId();
    const existing = this.#sessions.get(key);
    if (existing) {
      // Two concurrent opens of the same file: keep the first, discard this.
      await session.dispose();
      return existing;
    }

    const live = new LiveSession(key, session, manager);
    live.start();
    live.armPlanProposals();
    this.#sessions.set(key, live);
    return live;
  }

  /**
   * Move a live session to the id omp minted for it, e.g. after a fork or a
   * branch, and return it under its new key.
   */
  rekey(oldKey: string): LiveSession {
    const live = this.#sessions.get(oldKey);
    if (!live) throw new Error(`Session ${oldKey} is not live.`);
    const next = live.manager.getSessionId();
    if (next === oldKey) return live;
    this.#sessions.delete(oldKey);
    // A fresh id cannot legitimately collide; if it does, two agents would be
    // writing one file, so the older entry is disposed rather than orphaned.
    const clash = this.#sessions.get(next);
    if (clash && clash !== live) {
      this.#sessions.delete(next);
      void clash.dispose().catch(() => undefined);
    }
    live.adoptKey(next);
    this.#sessions.set(next, live);
    return live;
  }

  /** Stop a live session, disposing its agent and removing it from memory. */
  async stop(key: string): Promise<boolean> {
    const live = this.#sessions.get(key);
    if (!live) return false;
    this.#sessions.delete(key);
    await live.dispose();
    return true;
  }

  /** Delete a session from disk and dispose it if live. */
  async delete(key: string): Promise<void> {
    let filePath: string | undefined;

    const live = this.#sessions.get(key);
    if (live) {
      filePath = live.session.sessionFile;
      this.#sessions.delete(key);
      await live.dispose();
    }

    if (!filePath) {
      const all = await SessionManager.listAll();
      const match = all.find(s => s.id === key);
      filePath = match?.path;
    }

    if (!filePath) throw new Error(`Session ${key} not found on disk.`);

    // Delete session file
    await fs.promises.unlink(filePath).catch(() => undefined);

    // Delete sibling artifacts directory (e.g. `2026-09-01T..._uuid/`)
    const artifactsDir = filePath.replace(/\.jsonl$/u, "");
    await fs.promises.rm(artifactsDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async disposeAll(): Promise<void> {
    const all = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(all.map(live => live.dispose()));
  }
}

interface SharedServices {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settings: Settings;
}

export const registry = new Registry();
