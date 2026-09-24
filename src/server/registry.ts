import * as fs from "node:fs";
import * as path from "node:path";
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
import type {
  ActiveSessionOverview,
  LiveState,
  ModelOption,
  PlanState,
  SubagentStatus,
  SubagentTask,
  ThinkingLevel,
} from "../shared/model.ts";
import {
  formatAbsoluteTime,
  formatRateLimitUniformMessage,
  formatRelativeTime,
  parseRateLimit,
  type RateLimitInfo,
} from "../shared/ratelimit.ts";
import { A2uiChannel, createA2uiTools } from "./a2ui.ts";
import { type AguiFrame, AguiTranslator, custom } from "./agui.ts";
import { getGitStatus } from "./git.ts";
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
  readonly a2ui: A2uiChannel;
  readonly registry?: Registry;
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
  /** Active rate limit details when the last turn failed due to rate limits. */
  #rateLimit: RateLimitInfo | undefined;
  readonly #subagents = new Map<string, SubagentTask>();

  constructor(key: string, session: AgentSession, manager: SessionManager, a2ui: A2uiChannel, registry?: Registry) {
    this.#key = key;
    this.session = session;
    this.manager = manager;
    this.a2ui = a2ui;
    this.registry = registry;
    this.#translator = new AguiTranslator(key);
  }

  get key(): string {
    return this.#key;
  }
  get rateLimit(): RateLimitInfo | undefined {
    return this.#rateLimit;
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
    this.#unsubscribe = this.session.subscribe((event) => {
      // Every session event is the agent doing something — a message delta, a
      // tool call, a turn boundary — so any of them resets the idle clock and
      // a long tool-heavy turn is never evicted mid-flight.
      this.touch();
      // A new turn supersedes the last failure; keeping it would caption a
      // running turn with the reason the previous one stopped. Clear prior
      // turn replay frames so a reconnect mid-turn only receives the current turn.
      if (event.type === "agent_start") {
        this.#lastError = undefined;
        this.#rateLimit = undefined;
        this.#replay.length = 0;
      }
      if (
        event.type === "message_end" &&
        (event as any).message?.role === "assistant" &&
        (event as any).message?.stopReason === "error"
      ) {
        const errorText = (event as any).message?.errorMessage || "The model returned an error.";
        this.recordError(errorText);
      }
      for (const frame of this.#translator.translate(event)) {
        this.#emit(frame);
      }
      // A settled turn changes model/queue/context/plan state that the REST
      // snapshot owns; tell the client to refetch rather than duplicating
      // every field in the stream.
      if (event.type === "agent_end" && event.isTerminal !== false) {
        this.#emit(custom("omp.state", { reason: "agent_end" }));
        // Once the turn is finished and durable in transcript storage, clear
        // the replay buffer so a freshly reconnecting socket never replays stale
        // streaming frames from an already-completed turn.
        this.#replay.length = 0;

        // Broadcast cross-session turn completion notification to all other sessions
        const assistantMsgs = this.session.messages.filter((m: any) => m.role === "assistant");
        const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
        let summaryText: string | undefined;
        if (lastAssistant && "content" in lastAssistant && Array.isArray(lastAssistant.content)) {
          const textParts = (lastAssistant.content as any[])
            .filter((c: any) => c && c.type === "text" && typeof c.text === "string")
            .map((c: any) => c.text);
          summaryText = textParts.join("\n").trim().slice(0, 180);
        }

        this.registry?.broadcastCrossSessionNotification({
          key: this.key,
          title: this.manager.getSessionName() || "Untitled session",
          cwd: this.manager.getCwd(),
          status: "completed",
          summary: summaryText || "Turn completed.",
        });
      }
    });
  }

  #emit(frame: AguiFrame): void {
    this.#replay.push(frame);
    if (this.#replay.length > REPLAY_LIMIT) {
      this.#replay.splice(0, this.#replay.length - REPLAY_LIMIT);
    }
    for (const sink of this.#sinks) {
      sink(frame);
    }
  }
  /** Send an ephemeral frame to currently attached live sinks without storing in #replay. */
  broadcastLive(frame: AguiFrame): void {
    for (const sink of this.#sinks) {
      sink(frame);
    }
  }

  /** Record an error and check if it represents a rate limit. */
  recordError(rawError: string): void {
    const rateLimit = parseRateLimit(rawError);
    if (rateLimit) {
      this.#rateLimit = rateLimit;
      this.#lastError = rateLimit.message;
    } else {
      this.#rateLimit = undefined;
      this.#lastError = rawError;
    }

    this.registry?.broadcastCrossSessionNotification({
      key: this.key,
      title: this.manager.getSessionName() || "Untitled session",
      cwd: this.manager.getCwd(),
      status: "error",
      error: this.#lastError,
    });
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
      const errorText = typeof message === "string" ? message : "The turn failed.";
      this.recordError(errorText);
      if (this.#rateLimit) {
        (frame as unknown as { message: string }).message = this.#rateLimit.message;
      }
    }
    this.#emit(frame);
  }

  /** Attach a sink and replay what it missed. Returns the detach function. */
  subscribe(sink: FrameSink): () => void {
    for (const frame of this.#replay) {
      sink(frame);
    }
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
    return session.isStreaming || session.isBashRunning || session.isEvalRunning || this.#pendingPlan !== undefined;
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
    if (busy || this.#wasBusy) {
      this.touch();
    }
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
    this.session.setPlanProposalHandler(async (title) => {
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

      await new Promise<void>((resolve) => {
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
    if (!state?.enabled) {
      return undefined;
    }
    return {
      enabled: true,
      planFilePath: this.#pendingPlan?.planFilePath ?? state.planFilePath,
      awaitingApproval: this.#pendingPlan !== undefined,
      title: this.#pendingPlan?.title,
    };
  }
  get subagents(): SubagentTask[] {
    return [...this.#subagents.values()];
  }

  updateSubagent(task: SubagentTask): void {
    this.#subagents.set(task.id, task);
    this.emitCustom(custom("omp.subagents", { subagents: this.subagents }));
  }

  /**
   * Ids of prompts already delivered, newest last.
   *
   * Bounded because it only has to outlive a retry, not the conversation: an
   * outbox replays within seconds of reconnecting, and a session that has
   * taken 256 messages since is not going to be handed an older one.
   */
  readonly #delivered = new Set<string>();

  wasDelivered(idempotencyKey: string): boolean {
    return this.#delivered.has(idempotencyKey);
  }

  markDelivered(idempotencyKey: string): void {
    this.#delivered.add(idempotencyKey);
    if (this.#delivered.size > 256) {
      const oldest = this.#delivered.values().next();
      if (!oldest.done) {
        this.#delivered.delete(oldest.value);
      }
    }
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
      todos: this.session.getTodoPhases().map((phase: any) => ({
        name: phase.name,
        tasks: phase.tasks.map((task: any) => ({
          content: task.content,
          status: task.status,
          blocker: task.blocker,
        })),
      })),
      rateLimit: this.liveRateLimit(),
      lastError: this.#lastError,
      subagents: this.subagents,
    };
  }

  /** Calculate current live rate limit snapshot with updated relative time. */
  liveRateLimit(): RateLimitInfo | undefined {
    if (!this.#rateLimit) {
      return undefined;
    }
    const now = Date.now();
    const remainingMs = Math.max(0, this.#rateLimit.resetsAt - now);
    return {
      ...this.#rateLimit,
      relative: formatRelativeTime(remainingMs),
      absolute: formatAbsoluteTime(this.#rateLimit.resetsAt),
      message: formatRateLimitUniformMessage(this.#rateLimit.resetsAt, now),
    };
  }

  /** Role tiers the approved plan can be executed with. */
  tiers(): Array<{ role: string; ref: string; name: string }> {
    const cycle = this.session.getRoleModelCycle(PLAN_TIER_ORDER);
    if (!cycle) {
      return [];
    }
    return cycle.models.map((entry) => ({
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
    for (const listener of this.#closeListeners) {
      listener();
    }
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
const IDLE_MINUTES = Number(process.env.OMEGA_IDLE_MINUTES ?? 480);

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

  /** Broadcast an ephemeral session lifecycle event to currently attached live sinks. */
  broadcastCrossSessionNotification(event: {
    key: string;
    title: string;
    cwd: string;
    status: "completed" | "error";
    summary?: string;
    error?: string;
  }): void {
    const frame = custom("omp.cross_session_notification", {
      ...event,
      timestamp: Date.now(),
    });
    for (const live of this.#sessions.values()) {
      live.broadcastLive(frame);
    }
  }
  /** Detailed overview of all currently active/live sessions. */
  async listActiveSessions(): Promise<ActiveSessionOverview[]> {
    const active: ActiveSessionOverview[] = [];
    const now = Date.now();

    for (const [key, live] of this.#sessions) {
      const state = live.state();
      const cwd = live.manager.getCwd();
      const workdir = path.basename(cwd);
      const title = live.manager.getSessionName() || "Untitled session";
      const model = live.session.model;
      const modelName = model?.name || model?.id || "Default model";
      const thinkingLevel = (live.session.thinkingLevel ?? "off") as ThinkingLevel;
      const agentArchetype = (live.session as any).agent?.name || "main";

      let assistantTurns = 0;
      let totalTokens = 0;
      let totalCost = 0;
      for (const msg of live.session.messages) {
        if (msg.role === "assistant") {
          assistantTurns++;
          if (msg.usage) {
            totalTokens += msg.usage.totalTokens;
            if (msg.usage.cost) {
              totalCost += msg.usage.cost.total;
            }
          }
        }
      }

      const allTodos = state.todos?.flatMap((p) => p.tasks) ?? [];
      const completedTodos = allTodos.filter((t) => t.status === "completed").length;

      let gitBranch: string | undefined;
      let gitChangedFiles: number | undefined;
      try {
        const gitStatus = await getGitStatus(cwd);
        gitBranch = gitStatus.branch;
        gitChangedFiles = Object.keys(gitStatus.files ?? {}).length;
      } catch {
        gitBranch = undefined;
        gitChangedFiles = undefined;
      }
      let sessionState: "streaming" | "idle" | "awaiting_plan" | "error" | "rate_limited" = "idle";
      let turnCompletedDot: "completed" | "error" | "streaming" | "idle" | "rate_limited" = "idle";

      const rateLimit = live.liveRateLimit();

      if (live.session.isStreaming) {
        sessionState = "streaming";
        turnCompletedDot = "streaming";
      } else if (rateLimit) {
        sessionState = "rate_limited";
        turnCompletedDot = "rate_limited";
      } else if (state.lastError) {
        sessionState = "error";
        turnCompletedDot = "error";
      } else if (state.plan?.awaitingApproval) {
        sessionState = "awaiting_plan";
        turnCompletedDot = "completed";
      } else if (assistantTurns > 0) {
        sessionState = "idle";
        turnCompletedDot = "completed";
      }

      active.push({
        key,
        sessionFile: live.session.sessionFile ?? "",
        cwd,
        workdir,
        title,
        gitBranch,
        gitChangedFiles,
        model: model ? `${model.provider}/${model.id}` : "",
        modelName,
        thinkingLevel,
        agentArchetype,
        state: sessionState,
        turnCompletedDot,
        messageCount: live.session.messages.length,
        assistantTurns,
        queuedMessages: live.session.queuedMessageCount || state.queued || 0,
        totalTokens,
        totalCost,
        totalTodos: allTodos.length,
        completedTodos,
        contextUsage: state.contextUsage,
        rateLimit,
        lastError: state.lastError,
        lastActivityAt: live.idleFor(now),
        idleSeconds: Math.round(live.idleFor(now) / 1000),
      });
    }

    return active.sort((a, b) => a.lastActivityAt - b.lastActivityAt);
  }
  /**
   * Start the idle sweep. One timer serves every session, so an idle process
   * wakes on a fixed cadence rather than once per conversation.
   */
  startSweeping(onEvict: (key: string, idleMinutes: number) => void): void {
    this.#onEvict = onEvict;
    if (IDLE_MINUTES <= 0 || this.#sweeper) {
      return;
    }
    const limitMs = IDLE_MINUTES * 60_000;
    this.#sweeper = setInterval(
      () => {
        const now = Date.now();
        for (const [key, live] of this.#sessions) {
          // A working agent is not an idle session, whatever the user is
          // doing. `sampleBusy` both answers that and keeps the idle clock
          // pinned to the work, so a job is neither evicted while it runs nor
          // evicted the instant it finishes.
          if (live.sampleBusy()) {
            continue;
          }
          const idle = live.idleFor(now);
          if (idle < limitMs) {
            continue;
          }
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
    return modelRegistry.getAvailable().map((model) => ({
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
    const match = modelRegistry.getAvailable().find((model) => `${model.provider}/${model.id}` === ref);
    if (!match) {
      throw new Error(`Model not available: ${ref}`);
    }
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
        if (live.session.sessionFile === options.sessionPath) {
          return live;
        }
      }
    }

    if (!options.sessionPath && !options.cwd) {
      throw new Error("cwd is required when sessionPath is omitted");
    }
    const { authStorage, modelRegistry, settings } = await this.#services();
    const manager = options.sessionPath
      ? await SessionManager.open(options.sessionPath)
      : SessionManager.create(options.cwd as string);
    const a2uiChannel = new A2uiChannel();
    const a2uiTools = createA2uiTools(a2uiChannel);

    const result = await createAgentSession({
      authStorage,
      modelRegistry,
      settings,
      sessionManager: manager,
      cwd: manager.getCwd(),
      // The browser is the UI, but omp's `hasUI` gates terminal-only
      // surfaces (LSP warmup, title bar). Leave it false and drive the
      // surfaces this host actually implements explicitly.
      hasUI: false,
      customTools: a2uiTools,
    });
    const { session, subagentEventBus } = result;
    const key = manager.getSessionId();
    const existing = this.#sessions.get(key);
    if (existing) {
      // Two concurrent opens of the same file: keep the first, discard this.
      await session.dispose();
      return existing;
    }

    const live = new LiveSession(key, session, manager, a2uiChannel, this);
    live.start();
    live.armPlanProposals();
    this.#sessions.set(key, live);
    a2uiChannel.attach((message) => {
      live.emitCustom(custom("omp.a2ui", message));
    });

    if (subagentEventBus) {
      subagentEventBus.on("task:subagent:lifecycle", (payload: any) => {
        if (!payload?.id) {
          return;
        }
        const status = payload.status === "started" ? "running" : payload.status;
        const existing = live.subagents.find((s) => s.id === payload.id);
        const task: SubagentTask = {
          id: payload.id,
          agent: payload.agent || "task",
          description: payload.description || payload.task || existing?.description,
          status: status as SubagentStatus,
          startedAt: existing?.startedAt ?? Date.now(),
          completedAt: status !== "running" ? (existing?.completedAt ?? Date.now()) : undefined,
          error: payload.error || existing?.error,
        };
        live.updateSubagent(task);
      });
      subagentEventBus.on("task:subagent:progress", (payload: any) => {
        if (!payload) {
          return;
        }
        const id = payload.id || `task-${payload.index}`;
        const existing = live.subagents.find((s) => s.id === id || (payload.task && s.description === payload.task));
        if (existing && payload.task && !existing.description) {
          live.updateSubagent({ ...existing, description: payload.task });
        }
      });
    }

    return live;
  }
  /**
   * Move a live session to the id omp minted for it, e.g. after a fork or a
   * branch, and return it under its new key.
   */
  rekey(oldKey: string): LiveSession {
    const live = this.#sessions.get(oldKey);
    if (!live) {
      throw new Error(`Session ${oldKey} is not live.`);
    }
    const next = live.manager.getSessionId();
    if (next === oldKey) {
      return live;
    }
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
    if (!live) {
      return false;
    }
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
      const match = all.find((s) => s.id === key);
      filePath = match?.path;
    }

    if (!filePath) {
      throw new Error(`Session ${key} not found on disk.`);
    }

    // Delete session file
    await fs.promises.unlink(filePath).catch(() => undefined);

    // Delete sibling artifacts directory (e.g. `2026-09-01T..._uuid/`)
    const artifactsDir = filePath.replace(/\.jsonl$/u, "");
    await fs.promises.rm(artifactsDir, { recursive: true, force: true }).catch(() => undefined);
  }

  async disposeAll(): Promise<void> {
    const all = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(all.map((live) => live.dispose()));
  }
}

interface SharedServices {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settings: Settings;
}

export const registry = new Registry();
