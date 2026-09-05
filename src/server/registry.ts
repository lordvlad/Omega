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
  readonly key: string;
  readonly session: AgentSession;
  readonly manager: SessionManager;
  readonly #translator: AguiTranslator;
  readonly #sinks = new Set<FrameSink>();
  readonly #closeListeners = new Set<() => void>();
  readonly #replay: AguiFrame[] = [];
  #pendingPlan: PendingPlan | undefined;
  #unsubscribe: (() => void) | undefined;
  /** Epoch ms of the last user or agent message. Drives idle eviction. */
  #lastActivityAt = Date.now();

  constructor(key: string, session: AgentSession, manager: SessionManager) {
    this.key = key;
    this.session = session;
    this.manager = manager;
    this.#translator = new AguiTranslator(key);
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

  /** Push an out-of-band frame, e.g. a plan proposal. */
  emitCustom(frame: AguiFrame): void {
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
          // Never evict mid-turn: a turn that has been thinking for longer than
          // the idle window is busy, not abandoned.
          if (live.session.isStreaming) continue;
          // Nor while a plan is parked waiting on the user's decision.
          if (live.pendingPlan) continue;
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

    const key = session.sessionId;
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
