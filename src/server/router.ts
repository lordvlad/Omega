import type { ThinkingLevel as OmpThinkingLevel } from "@oh-my-pi/pi-agent-core";

import type {
  Ack,
  LiveState,
  MarkdownRequest,
  ModelOption,
  OpenSessionRequest,
  PlanActionRequest,
  PlanDocument,
  PlanEditRequest,
  PlanModeRequest,
  PromptRequest,
  RenderedMarkdown,
  SelectModelRequest,
  Transcript,
  Workspace,
} from "../shared/model.ts";
/**
 * REST handlers, one per `OmpApi` method.
 *
 * `Handlers implements OmpApi` is what keeps this honest: a route whose
 * signature drifts from `src/shared/service.ts` — and therefore from the
 * generated client — is a type error here.
 */
import type { OmpApi } from "../shared/service.ts";
import { planDocument, resolvePlan, writePlan } from "./plan.ts";
import { type LiveSession, registry } from "./registry.ts";
import { flattenMessages } from "./transcript.ts";
import { listWorkspaces } from "./workspaces.ts";

/** Raised by handlers to select a non-200 status. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** The default plan file a session uses until the agent names its own. */
const DEFAULT_PLAN_FILE = "local:" + "//PLAN.md";

export class Handlers implements OmpApi {
  listWorkspaces(): Promise<Workspace[]> {
    return listWorkspaces(id => registry.isLive(id));
  }

  listModels(): Promise<ModelOption[]> {
    return registry.listModels();
  }

  async openSession(body: OpenSessionRequest): Promise<LiveState> {
    if (!body.sessionPath && !body.cwd) {
      throw new HttpError(400, "Provide sessionPath to resume, or cwd to start a new session.");
    }
    try {
      const live = await registry.open(body);
      return live.state();
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async getState(key: string): Promise<LiveState> {
    return this.#require(key).state();
  }

  async getTranscript(key: string): Promise<Transcript> {
    const live = this.#require(key);
    return { key, messages: flattenMessages(live.session.messages) };
  }

  async prompt(key: string, body: PromptRequest): Promise<Ack> {
    const live = this.#require(key);
    const message = body.message.trim();
    if (!message) throw new HttpError(400, "Message is empty.");
    // A user message is activity even if the agent never replies, so the idle
    // clock restarts here rather than only on agent events.
    live.touch();

    // A prompt sent while a turn is running must say how to queue; omp
    // rejects an ambiguous one. Default to steering, which is what a user
    // typing into a live chat means.
    if (live.session.isStreaming) {
      const deliverAs = body.deliverAs ?? "steer";
      if (deliverAs === "followUp") await live.session.followUp(message);
      else await live.session.steer(message);
      return { ok: true, detail: `Queued as ${deliverAs}.` };
    }

    // Fire-and-forget: `prompt` resolves only when the whole turn ends, and
    // the turn is streamed over the WebSocket instead.
    void live.session.prompt(message).catch(error => {
      live.emitCustom({
        type: "RUN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return { ok: true, detail: "Turn started." };
  }

  async abort(key: string): Promise<Ack> {
    const live = this.#require(key);
    if (!live.session.isStreaming) return { ok: true, detail: "Nothing to abort." };
    await live.session.abort({ reason: "user interrupt" });
    return { ok: true, detail: "Turn aborted." };
  }

  async selectModel(key: string, body: SelectModelRequest): Promise<LiveState> {
    const live = this.#require(key);
    try {
      const model = await registry.resolveModel(body.ref);
      const level = body.thinkingLevel as OmpThinkingLevel | undefined;
      await live.session.setModel(model, "default", { thinkingLevel: level });
      if (level) live.session.setThinkingLevel(level);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return live.state();
  }

  getPlan(key: string): Promise<PlanDocument> {
    return planDocument(this.#require(key));
  }

  async setPlanMode(key: string, body: PlanModeRequest): Promise<PlanDocument> {
    const live = this.#require(key);
    if (body.enabled) {
      const existing = live.session.getPlanModeState();
      const planFilePath = existing?.planFilePath || live.session.getPlanReferencePath() || DEFAULT_PLAN_FILE;
      live.session.setPlanModeState({ enabled: true, planFilePath });
      live.manager.appendModeChange("plan", { planFilePath });
      live.armPlanProposals();
      // Plan mode changes the system prompt, so the running turn needs the
      // new context; idle sessions pick it up on their next prompt.
      await live.session.sendPlanModeContext({ deliverAs: live.session.isStreaming ? "steer" : "nextTurn" });
    } else {
      live.session.setPlanProposalHandler(null);
      live.session.setPlanModeState(undefined);
      live.manager.appendModeChange("none");
      live.settlePlan();
    }
    return planDocument(live);
  }

  async editPlan(key: string, body: PlanEditRequest): Promise<PlanDocument> {
    const live = this.#require(key);
    await writePlan(live, body.content);
    return planDocument(live);
  }

  async resolvePlan(key: string, body: PlanActionRequest): Promise<Ack> {
    const live = this.#require(key);
    try {
      const outcome = await resolvePlan(registry, live, body);
      return { ok: true, detail: outcome.detail, sessionKey: outcome.sessionKey };
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async renderMarkdown(body: MarkdownRequest): Promise<RenderedMarkdown> {
    return { html: Bun.markdown.html(body.text) };
  }

  #require(key: string): LiveSession {
    const live = registry.get(key);
    if (!live) throw new HttpError(404, `Session ${key} is not open.`);
    return live;
  }
}

export const handlers = new Handlers();
