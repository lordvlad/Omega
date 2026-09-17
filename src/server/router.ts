import type { ThinkingLevel as OmpThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { ImageContent } from "@oh-my-pi/pi-ai";

import type {
  A2uiDismissRequest,
  Ack,
  AddMcpServerRequest,
  Attachment,
  BranchPoint,
  BranchRequest,
  BranchResult,
  BtwRequest,
  BtwResult,
  CancelJobRequest,
  CompactRequest,
  DeleteRuleRequest,
  ForceToolRequest,
  GitStatusQuery,
  GitStatusResult,
  ListFilesQuery,
  ListJobsResult,
  ListMcpServersQuery,
  ListMcpServersResult,
  ListProcessesQuery,
  ListProcessesResult,
  ListRulesResult,
  ListToolsResult,
  LiveState,
  MarkdownRequest,
  ModelOption,
  OmfgAnalyzeRequest,
  OmfgRuleCandidate,
  OmfgSaveRequest,
  OpenSessionRequest,
  PlanActionRequest,
  PlanDocument,
  PlanEditRequest,
  PlanModeRequest,
  ProcessActionRequest,
  PromptRequest,
  QueueDropRequest,
  QueueEditRequest,
  QueuedMessage,
  ReadFileQuery,
  ReadFileResult,
  RemoveMcpServerRequest,
  RenameRequest,
  RenderedMarkdown,
  SelectModelRequest,
  ShakeRequest,
  SignalProcessRequest,
  SlashCommand,
  TestMcpServerRequest,
  TestMcpServerResult,
  ThinkingRequest,
  Transcript,
  TranscriptQuery,
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
import { listFiles, readFileContent } from "./files.ts";
import { getGitStatus } from "./git.ts";
import {
  cancelSessionJob,
  listManagedProcesses,
  listSessionJobs,
  restartManagedProcess,
  signalManagedProcess,
  stopManagedProcess,
} from "./jobs-processes.ts";
import { renderMarkdownServer } from "./markdown.ts";
import {
  addMcpServerConfig,
  listAllMcpServers,
  removeMcpServerConfig,
  testMcpServerConnection,
} from "./mcp.ts";
import { analyzeOmfgRule, saveOmfgRule } from "./omfg.ts";
import { planDocument, resolvePlan, writePlan } from "./plan.ts";
import { dropQueued, editQueued, listQueue } from "./queue.ts";
import { type LiveSession, registry } from "./registry.ts";
import { drawCostSurface, drawStatsSurface, drawUsageSurface } from "./stats.ts";
import { deleteSessionRule, forceSessionTool, listSessionRules, listSessionTools } from "./tools-rules.ts";
import { flattenSession, pageTranscript } from "./transcript.ts";
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

/**
 * Largest text attachment that will be inlined, in decoded bytes.
 *
 * Inlining spends context that the conversation then carries for the rest of
 * its life, so a whole logfile is refused rather than quietly truncated: a
 * half a log is worse than a clear refusal, because nobody can see where it
 * was cut.
 */
const MAX_INLINE_TEXT_BYTES = 256 * 1024;

/** Types omp can hand to a model as an image. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** True for types whose bytes are meaningfully readable as text. */
function isTextual(mimeType: string, name: string): boolean {
  if (mimeType.startsWith("text/")) return true;
  if (/^application\/(json|xml|x-yaml|yaml|javascript|typescript|sql|toml)$/.test(mimeType)) return true;
  if (mimeType === "application/octet-stream" || mimeType === "") {
    // Browsers report an empty or generic type for plenty of ordinary source
    // files, so fall back to the extension rather than refusing a .ts file.
    return /\.(txt|md|markdown|json|jsonl|ya?ml|toml|ini|cfg|conf|csv|tsv|log|diff|patch|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cc|cpp|hpp|cs|sh|bash|zsh|sql|html|css|scss|xml|svg)$/i.test(
      name,
    );
  }
  return false;
}

/**
 * Fold attachments into what omp can actually accept.
 *
 * Images become native attachments, so the model sees the pixels. Everything
 * textual is appended to the message in a fenced block labelled with its
 * filename, because omp has no second channel for it and a path would only
 * work for files that already exist in the workspace. Anything else is a
 * `400`: base64 in the prompt would burn context and tell the model nothing.
 */
function composeAttachments(
  message: string,
  attachments: Attachment[] | undefined,
): { text: string; images: ImageContent[] | undefined } {
  if (!attachments?.length) return { text: message, images: undefined };

  const images: ImageContent[] = [];
  const blocks: string[] = [];

  for (const file of attachments) {
    const type = file.mimeType.toLowerCase();
    if (IMAGE_TYPES.has(type)) {
      images.push({ type: "image", data: file.data, mimeType: type });
      continue;
    }
    if (!isTextual(type, file.name)) {
      throw new HttpError(
        415,
        `${file.name}: omega can attach images and text files. ${file.mimeType || "This type"} is neither.`,
      );
    }

    const bytes = Buffer.from(file.data, "base64");
    if (bytes.byteLength > MAX_INLINE_TEXT_BYTES) {
      throw new HttpError(
        413,
        `${file.name} is ${Math.round(bytes.byteLength / 1024)} KB. Text attachments are inlined into the message, so they are capped at ${MAX_INLINE_TEXT_BYTES / 1024} KB.`,
      );
    }

    // A fence long enough that fences inside the file cannot end the block.
    const content = bytes.toString("utf8");
    const fence = "`".repeat(Math.max(3, longestBacktickRun(content) + 1));
    blocks.push(`${fence} ${file.name}\n${content}\n${fence}`);
  }

  const text = blocks.length > 0 ? `${message}\n\n${blocks.join("\n\n")}` : message;
  return { text, images: images.length > 0 ? images : undefined };
}

/** Length of the longest run of backticks, so a fence can outgrow it. */
function longestBacktickRun(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  return longest;
}

export class Handlers implements OmpApi {
  listWorkspaces(): Promise<Workspace[]> {
    return listWorkspaces(id => registry.isLive(id));
  }

  listModels(): Promise<ModelOption[]> {
    return registry.listModels();
  }

  listFiles(query?: ListFilesQuery): Promise<string[]> {
    return listFiles(query?.cwd);
  }

  async getFileContent(query?: ReadFileQuery): Promise<ReadFileResult> {
    if (!query?.path) throw new HttpError(400, "File path is required.");
    try {
      return await readFileContent(query.path, query.cwd);
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
  }

  getGitStatus(query?: GitStatusQuery): Promise<GitStatusResult> {
    return getGitStatus(query?.cwd);
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

  async getTranscript(key: string, query?: TranscriptQuery): Promise<Transcript> {
    const live = this.#require(key);
    // The agent's messages are what render; the session entries carry the ids
    // and the failures the agent dropped. They hold the same message objects,
    // so identity correlates them without either list being re-derived.
    const all = flattenSession(live.session.messages, live.manager.getEntries());
    const window = pageTranscript(all, query);
    return { key, messages: window.messages, hasMore: window.hasMore };
  }

  async prompt(key: string, body: PromptRequest): Promise<Ack> {
    const live = this.#require(key);
    const { text: message, images } = composeAttachments(body.message.trim(), body.attachments);

    if (message === "/usage") {
      await drawUsageSurface(live);
      return { ok: true, detail: "Provider usage limits rendered." };
    }
    if (message === "/cost") {
      await drawCostSurface(live);
      return { ok: true, detail: "Token economics rendered." };
    }
    if (message === "/stats") {
      await drawStatsSurface(live);
      return { ok: true, detail: "Session statistics rendered." };
    }
    // The browser's outbox retries until a send is acknowledged, so the same
    // message can arrive twice: once delivered, once replayed from a snapshot
    // written before the acknowledgement. Answering a key already seen keeps
    // that retry honest instead of duplicating the message.
    if (body.idempotencyKey && live.wasDelivered(body.idempotencyKey)) {
      return { ok: true, detail: "Already delivered." };
    }
    if (body.idempotencyKey) live.markDelivered(body.idempotencyKey);
    // A user message is activity even if the agent never replies, so the idle
    // clock restarts here rather than only on agent events.
    live.touch();

    // A prompt sent while a turn is running must say how to queue; omp
    // rejects an ambiguous one. Default to steering, which is what a user
    // typing into a live chat means.
    if (live.session.isStreaming) {
      const deliverAs = body.deliverAs ?? "steer";
      if (deliverAs === "followUp") await live.session.followUp(message, images);
      else await live.session.steer(message, images);
      return { ok: true, detail: `Queued as ${deliverAs}.` };
    }

    // Fire-and-forget: `prompt` resolves only when the whole turn ends, and
    // the turn is streamed over the WebSocket instead.
    void live.session.prompt(message, images ? { images } : undefined).catch(error => {
      live.emitCustom({
        type: "RUN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return { ok: true, detail: "Turn started." };
  }

  listQueue(key: string): Promise<QueuedMessage[]> {
    return Promise.resolve(listQueue(this.#require(key)));
  }

  editQueued(key: string, body: QueueEditRequest): Promise<QueuedMessage[]> {
    return Promise.resolve(editQueued(this.#require(key), body));
  }

  dropQueued(key: string, body: QueueDropRequest): Promise<QueuedMessage[]> {
    return Promise.resolve(dropQueued(this.#require(key), body));
  }

  async abort(key: string): Promise<Ack> {
    const live = this.#require(key);
    if (!live.session.isStreaming) return { ok: true, detail: "Nothing to abort." };
    await live.session.abort({ reason: "user interrupt" });
    return { ok: true, detail: "Turn aborted." };
  }

  async askBtw(key: string, body: BtwRequest): Promise<BtwResult> {
    const live = this.#require(key);
    const question = body.question?.trim();
    if (!question) throw new HttpError(400, "Question is required for /btw.");
    const promptText = `<btw>\nEphemeral side question for current interactive session.\nAnswer briefly, directly; use conversation context already provided.\nNEVER use tools.\nNEVER ask follow-up questions.\nQuestion:\n${question}\n</btw>`;
    try {
      const { replyText } = await live.session.runEphemeralTurn({ promptText, dedupeReply: false });
      return { answer: replyText };
    } catch (error) {
      throw new HttpError(500, error instanceof Error ? error.message : String(error));
    }
  }

  async analyzeOmfg(key: string, body: OmfgAnalyzeRequest): Promise<OmfgRuleCandidate> {
    const live = this.#require(key);
    try {
      return await analyzeOmfgRule(live, body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async saveOmfgRule(key: string, body: OmfgSaveRequest): Promise<Ack> {
    const live = this.#require(key);
    try {
      const result = await saveOmfgRule(live, body);
      return { ok: true, detail: result.detail };
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async dismissSurface(key: string, body: A2uiDismissRequest): Promise<Ack> {
    const live = this.#require(key);
    const surfaceId = body.surfaceId?.trim();
    if (!surfaceId) throw new HttpError(400, "surfaceId is required.");
    live.a2ui.dismissSurface(surfaceId);
    return { ok: true, detail: `Surface "${surfaceId}" dismissed.` };
  }

  async listMcpServers(query?: ListMcpServersQuery): Promise<ListMcpServersResult> {
    return await listAllMcpServers(query?.cwd);
  }

  async testMcpServer(body: TestMcpServerRequest): Promise<TestMcpServerResult> {
    return await testMcpServerConnection(body);
  }

  async addMcpServer(body: AddMcpServerRequest): Promise<Ack> {
    try {
      return await addMcpServerConfig(body.cwd, body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async removeMcpServer(body: RemoveMcpServerRequest): Promise<Ack> {
    try {
      return await removeMcpServerConfig(body.cwd, body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  listTools(key: string): Promise<ListToolsResult> {
    const live = this.#require(key);
    return Promise.resolve(listSessionTools(live));
  }

  forceTool(key: string, body: ForceToolRequest): Promise<Ack> {
    const live = this.#require(key);
    return Promise.resolve(forceSessionTool(live, body));
  }

  async listRules(key: string): Promise<ListRulesResult> {
    const live = this.#require(key);
    return await listSessionRules(live);
  }

  async deleteRule(key: string, body: DeleteRuleRequest): Promise<Ack> {
    const live = this.#require(key);
    try {
      return await deleteSessionRule(live, body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  listJobs(key: string): Promise<ListJobsResult> {
    const live = this.#require(key);
    return Promise.resolve(listSessionJobs(live));
  }

  cancelJob(key: string, body: CancelJobRequest): Promise<Ack> {
    const live = this.#require(key);
    try {
      return Promise.resolve(cancelSessionJob(live, body));
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async listProcesses(query?: ListProcessesQuery): Promise<ListProcessesResult> {
    return await listManagedProcesses(query?.cwd);
  }

  async signalProcess(body: SignalProcessRequest): Promise<Ack> {
    try {
      return await signalManagedProcess(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async stopProcess(body: ProcessActionRequest): Promise<Ack> {
    try {
      return await stopManagedProcess(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }

  async restartProcess(body: ProcessActionRequest): Promise<Ack> {
    try {
      return await restartManagedProcess(body);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
  }
  async stopSession(key: string): Promise<Ack> {
    const stopped = await registry.stop(key);
    return {
      ok: true,
      detail: stopped ? "Session stopped and released from memory." : "Session was not running.",
    };
  }

  async deleteSession(key: string): Promise<Ack> {
    try {
      await registry.delete(key);
      return { ok: true, detail: "Session and artifacts deleted from disk." };
    } catch (error) {
      throw new HttpError(404, error instanceof Error ? error.message : String(error));
    }
  }

  async selectModel(key: string, body: SelectModelRequest): Promise<LiveState> {
    const live = this.#require(key);
    try {
      const model = await registry.resolveModel(body.ref);
      const level = body.thinkingLevel as any;
      await live.session.setModel(model, "default", { thinkingLevel: level });
      if (level) live.session.setThinkingLevel(level);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    return live.state();
  }

  async compactSession(key: string, body: CompactRequest): Promise<Ack> {
    const live = this.#require(key);
    if (live.session.isStreaming) throw new HttpError(409, "Cannot compact while a turn is running.");
    const focus = body.focus?.trim();
    if (body.mode === "snapcompact" && focus) {
      throw new HttpError(400, "snapcompact writes no summary, so it takes no focus text.");
    }
    live.touch();
    const before = live.session.getContextUsage()?.tokens;
    try {
      await live.session.compact(focus || undefined, body.mode ? { mode: body.mode } : undefined);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    const after = live.session.getContextUsage()?.tokens;
    return {
      ok: true,
      detail:
        before != null && after != null
          ? `Compacted: ${before.toLocaleString()} → ${after.toLocaleString()} tokens.`
          : "Compaction complete.",
    };
  }

  async shakeSession(key: string, body: ShakeRequest): Promise<Ack> {
    const live = this.#require(key);
    if (live.session.isStreaming) throw new HttpError(409, "Cannot shake context while a turn is running.");
    live.touch();
    const result = await live.session.shake(body.mode);
    const dropped = [
      result.toolResultsDropped ? `${result.toolResultsDropped} tool results` : "",
      result.blocksDropped ? `${result.blocksDropped} blocks` : "",
      result.imagesDropped ? `${result.imagesDropped} images` : "",
    ].filter(part => part.length > 0);
    return {
      ok: true,
      detail: dropped.length
        ? `Dropped ${dropped.join(", ")}; freed ~${result.tokensFreed.toLocaleString()} tokens.`
        : "Nothing heavy left to drop.",
    };
  }

  async setThinkingLevel(key: string, body: ThinkingRequest): Promise<LiveState> {
    const live = this.#require(key);
    live.session.setThinkingLevel(body.level as any);
    return live.state();
  }

  async renameSession(key: string, body: RenameRequest): Promise<LiveState> {
    const live = this.#require(key);
    const title = body.title.trim();
    if (!title) throw new HttpError(400, "Title is empty.");
    // `source: "user"` is what omp's own `/rename` passes; an auto title never
    // overwrites a user-set one afterwards.
    const renamed = await live.manager.setSessionName(title, "user");
    if (!renamed) throw new HttpError(400, "Session name was not changed.");
    return live.state();
  }

  async retryTurn(key: string): Promise<Ack> {
    const live = this.#require(key);
    live.touch();
    const started = await live.session.retry();
    return {
      ok: started,
      detail: started ? "Retrying the last failed turn." : "Nothing to retry.",
    };
  }

  async forkSession(key: string): Promise<LiveState> {
    const live = this.#require(key);
    if (live.session.isStreaming) throw new HttpError(409, "Cannot fork while a turn is running.");
    live.touch();
    const forked = await live.session.fork();
    // `fork()` returns false when an extension's `session_before_switch`
    // handler cancels, or when the session does not persist to a file.
    if (!forked) throw new HttpError(409, "Fork was cancelled.");
    return registry.rekey(key).state();
  }

  async listBranchPoints(key: string): Promise<BranchPoint[]> {
    const live = this.#require(key);
    return live.session.getUserMessagesForBranching().map(point => ({
      entryId: point.entryId,
      text: point.text.replace(/\s+/gu, " ").trim().slice(0, 160),
    }));
  }

  async listCommands(key: string): Promise<SlashCommand[]> {
    const live = this.#require(key);
    // `mcpPromptCommands` rather than `customCommands`: the latter also holds
    // the TypeScript commands omp loads from disk, which this host does not
    // run and would be listing as available when they are not.
    return live.session.mcpPromptCommands
      .map(loaded => ({ name: loaded.command.name, description: loaded.command.description }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async branchSession(key: string, body: BranchRequest): Promise<BranchResult> {
    const live = this.#require(key);
    if (live.session.isStreaming) throw new HttpError(409, "Cannot branch while a turn is running.");
    live.touch();
    let branched: { selectedText: string; cancelled: boolean };
    try {
      // omp throws "Invalid entry ID for branching" for any entry that is not
      // a user message, including an id from an already-branched transcript.
      branched = await live.session.branch(body.entryId);
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : String(error));
    }
    if (branched.cancelled) throw new HttpError(409, "Branch was cancelled.");
    return { state: registry.rekey(key).state(), draft: branched.selectedText };
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
    const texts = body.texts ?? [];
    // One pass per text, but a single round trip: the parse is native and the
    // highlighter is shared, so the cost is in the request, not the render.
    const html = await Promise.all(texts.map(text => renderMarkdownServer(text)));
    return { html };
  }

  #require(key: string): LiveSession {
    const live = registry.get(key);
    if (!live) throw new HttpError(404, `Session ${key} is not open.`);
    return live;
  }
}

export const handlers = new Handlers();
