/**
 * The omega HTTP contract, declared once.
 *
 * `@get`/`@post`/`@put` supply the verb and path template OpenAPI cannot
 * infer; a parameter named in the path template becomes a path parameter, one
 * named `query` becomes query parameters and one named `body` becomes the
 * request body. `src/server/router.ts` implements this interface, so a handler
 * whose signature drifts from the contract is a type error rather than a
 * client that fails at runtime.
 *
 * Streaming is deliberately absent here: request/response state lives in this
 * document, while token deltas ride the AG-UI WebSocket at `/ws`. An OpenAPI
 * document cannot describe that socket, so nothing pretends it can.
 *
 * @service Omp
 */
import type {
  Ack,
  BranchPoint,
  BranchRequest,
  BranchResult,
  BtwRequest,
  BtwResult,
  CompactRequest,
  GitStatusQuery,
  GitStatusResult,
  ListFilesQuery,
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
  PlanState,
  PromptRequest,
  QueueDropRequest,
  QueueEditRequest,
  QueuedMessage,
  ReadFileQuery,
  ReadFileResult,
  ThinkingRequest,
  RenameRequest,
  RenderedMarkdown,
  SelectModelRequest,
  SessionSummary,
  ShakeRequest,
  SlashCommand,
  Transcript,
  TranscriptQuery,
  Workspace,
  WorkspaceFile,
} from "./model.ts";

export interface OmpApi {
  /**
   * Every directory with sessions on disk, each with its sessions nested.
   *
   * @get /api/workspaces
   * @summary List workspaces and their sessions
   * @response 200 application/json Workspace[]
   */
  listWorkspaces(): Promise<Workspace[]>;

  /**
   * Models the local omp install is authenticated for.
   *
   * @get /api/models
   * @summary List available models
   * @response 200 application/json ModelOption[]
   */
  listModels(): Promise<ModelOption[]>;

  /**
   * Files in a workspace directory, relative to `cwd`.
   *
   * @get /api/files
   * @response 200 application/json WorkspaceFile[]
   */
  listFiles(query?: ListFilesQuery): Promise<WorkspaceFile[]>;

  /**
   * Read content and metadata of a workspace file.
   *
   * @get /api/files/content
   * @response 200 application/json ReadFileResult
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  getFileContent(query?: ReadFileQuery): Promise<ReadFileResult>;

  /**
   * Git status for a workspace directory.
   *
   * @get /api/git/status
   * @response 200 application/json GitStatusResult
   */
  getGitStatus(query?: GitStatusQuery): Promise<GitStatusResult>;

  /**
   * Load a session as a live agent, or start a new one in `cwd`.
   *
   * Idempotent for an already-loaded session: the existing live agent is
   * returned rather than a second one being created for the same file.
   *
   * @post /api/sessions
   * @summary Open or create a live session
   * @response 200 application/json LiveState
   * @response 400 application/json Problem
   */
  openSession(body: OpenSessionRequest): Promise<LiveState>;

  /**
   * Current model, thinking level, streaming status and plan state.
   *
   * @get /api/sessions/{key}/state
   * @summary Read live session state
   * @response 200 application/json LiveState
   * @response 404 application/json Problem
   */
  getState(key: string): Promise<LiveState>;

  /**
   * One page of the session transcript, flattened into renderable parts.
   *
   * The newest `limit` messages by default; `before` walks backwards through
   * older history. Thinking and tool parts are dropped server-side when the
   * client says it will not draw them.
   *
   * @get /api/sessions/{key}/transcript
   * @summary Read the session transcript
   * @response 200 application/json Transcript
   * @response 404 application/json Problem
   */
  getTranscript(key: string, query?: TranscriptQuery): Promise<Transcript>;

  /**
   * Send a message. Returns as soon as the turn is scheduled; the reply
   * arrives as AG-UI frames on the session's WebSocket.
   *
   * @post /api/sessions/{key}/prompt
   * @summary Prompt the agent
   * @response 202 application/json Ack
   * @response 404 application/json Problem
   */
  prompt(key: string, body: PromptRequest): Promise<Ack>;

  /**
   * Abort the in-flight turn. Succeeds as a no-op when the session is idle.
   *
   * @post /api/sessions/{key}/abort
   * @summary Abort the current turn
   * @response 200 application/json Ack
   * @response 404 application/json Problem
   */
  abort(key: string): Promise<Ack>;

  /**
   * Ask a transient side question against this session's context.
   *
   * @post /api/sessions/{key}/btw
   * @summary Ask an ephemeral side question
   * @response 200 application/json BtwResult
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  askBtw(key: string, body: BtwRequest): Promise<BtwResult>;

  /**
   * Analyze a recurring mistake and synthesize a TTSR rule candidate.
   *
   * @post /api/sessions/{key}/omfg
   * @summary Generate a candidate stream rule from a complaint
   * @response 200 application/json OmfgRuleCandidate
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  analyzeOmfg(key: string, body: OmfgAnalyzeRequest): Promise<OmfgRuleCandidate>;

  /**
   * Save a synthesized rule to project or global rules directory.
   *
   * @post /api/sessions/{key}/omfg/save
   * @summary Save a rule to disk and register it live
   * @response 200 application/json Ack
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  saveOmfgRule(key: string, body: OmfgSaveRequest): Promise<Ack>;

  /**
   * The user messages waiting to be delivered, steering lane first.
   *
   * Empty whenever the session is idle: a queue only exists while a turn is
   * in flight to queue behind.
   *
   * @get /api/sessions/{key}/queue
   * @summary List queued messages
   * @response 200 application/json QueuedMessage[]
   * @response 404 application/json Problem
   */
  listQueue(key: string): Promise<QueuedMessage[]>;

  /**
   * Slash commands MCP servers contribute to this session.
   *
   * Session-scoped rather than global: which servers are connected, and so
   * which prompts exist, is a property of the agent, not of the install.
   *
   * @get /api/sessions/{key}/commands
   * @summary List MCP slash commands
   * @response 200 application/json SlashCommand[]
   * @response 404 application/json Problem
   */
  listCommands(key: string): Promise<SlashCommand[]>;

  /**
   * Rewrite a queued message in place, keeping its lane and position.
   *
   * Returns the queue as it stands afterwards, so the caller never has to
   * guess what the agent drained in the meantime.
   *
   * @post /api/sessions/{key}/queue/edit
   * @summary Edit a queued message
   * @response 200 application/json QueuedMessage[]
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   * @response 409 application/json Problem
   */
  editQueued(key: string, body: QueueEditRequest): Promise<QueuedMessage[]>;

  /**
   * Drop a queued message before it is delivered.
   *
   * @post /api/sessions/{key}/queue/drop
   * @summary Drop a queued message
   * @response 200 application/json QueuedMessage[]
   * @response 404 application/json Problem
   * @response 409 application/json Problem
   */
  dropQueued(key: string, body: QueueDropRequest): Promise<QueuedMessage[]>;

  /**
   * Stop and release a live agent session from memory.
   *
   * @post /api/sessions/{key}/stop
   * @summary Stop a live session
   * @response 200 application/json Ack
   * @response 404 application/json Problem
   */
  stopSession(key: string): Promise<Ack>;

  /**
   * Delete a session file and its artifacts from disk, disposing it first if live.
   *
   * @delete /api/sessions/{key}
   * @summary Delete a session from disk
   * @response 200 application/json Ack
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  deleteSession(key: string): Promise<Ack>;

  /**
   * Switch the live session's model, and optionally its thinking level.
   *
   * @post /api/sessions/{key}/model
   * @summary Select a model
   * @response 200 application/json LiveState
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  selectModel(key: string, body: SelectModelRequest): Promise<LiveState>;

  /**
   * Compact the session context now, mirroring omp's `/compact`.
   *
   * @post /api/sessions/{key}/compact
   * @summary Compact the session context
   * @response 200 application/json Ack
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   * @response 409 application/json Problem
   */
  compactSession(key: string, body: CompactRequest): Promise<Ack>;

  /**
   * Drop heavy content (tool results, large blocks, or images) from context.
   *
   * @post /api/sessions/{key}/shake
   * @summary Shake heavy content out of context
   * @response 200 application/json Ack
   * @response 404 application/json Problem
   * @response 409 application/json Problem
   */
  shakeSession(key: string, body: ShakeRequest): Promise<Ack>;

  /**
   * Set the session's thinking level without changing the model.
   *
   * @post /api/sessions/{key}/thinking
   * @summary Set the thinking level
   * @response 200 application/json LiveState
   * @response 404 application/json Problem
   */
  setThinkingLevel(key: string, body: ThinkingRequest): Promise<LiveState>;

  /**
   * Rename the session, as omp's `/rename` does.
   *
   * @post /api/sessions/{key}/title
   * @summary Rename the session
   * @response 200 application/json LiveState
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  renameSession(key: string, body: RenameRequest): Promise<LiveState>;

  /**
   * Re-run the last failed or aborted turn. The retried turn streams over the
   * session's WebSocket, so this returns as soon as it is scheduled.
   *
   * @post /api/sessions/{key}/retry
   * @summary Retry the last failed turn
   * @response 200 application/json Ack
   * @response 404 application/json Problem
   */
  retryTurn(key: string): Promise<Ack>;

  /**
   * Copy this session, transcript and artifacts included, into a new one and
   * continue in the copy. The original file stays on disk untouched.
   *
   * @post /api/sessions/{key}/fork
   * @summary Fork the session
   * @response 200 application/json LiveState
   * @response 404 application/json Problem
   * @response 409 application/json Problem
   */
  forkSession(key: string): Promise<LiveState>;

  /**
   * The user messages this session can branch from, oldest first.
   *
   * @get /api/sessions/{key}/branch-points
   * @summary List branch points
   * @response 200 application/json BranchPoint[]
   * @response 404 application/json Problem
   */
  listBranchPoints(key: string): Promise<BranchPoint[]>;

  /**
   * Restart the conversation from an earlier user message: omp writes a new
   * session containing everything up to that message's parent and continues
   * there, returning the message text so the composer can be pre-filled.
   *
   * @post /api/sessions/{key}/branch
   * @summary Branch from an earlier message
   * @response 200 application/json BranchResult
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   * @response 409 application/json Problem
   */
  branchSession(key: string, body: BranchRequest): Promise<BranchResult>;

  /**
   * The plan document, its headings and the executable role tiers — the three
   * planning panes in one payload.
   *
   * @get /api/sessions/{key}/plan
   * @summary Read the plan document
   * @response 200 application/json PlanDocument
   * @response 404 application/json Problem
   */
  getPlan(key: string): Promise<PlanDocument>;

  /**
   * Turn plan mode on or off for the live session.
   *
   * @post /api/sessions/{key}/plan/mode
   * @summary Toggle plan mode
   * @response 200 application/json PlanDocument
   * @response 404 application/json Problem
   */
  setPlanMode(key: string, body: PlanModeRequest): Promise<PlanDocument>;

  /**
   * Persist a hand-edited plan document, mirroring omp's in-overlay edits.
   *
   * @put /api/sessions/{key}/plan/document
   * @summary Edit the plan document
   * @response 200 application/json PlanDocument
   * @response 404 application/json Problem
   */
  editPlan(key: string, body: PlanEditRequest): Promise<PlanDocument>;

  /**
   * Resolve the plan review: approve and execute, approve and compact,
   * approve into a fresh session, or refine with feedback.
   *
   * @post /api/sessions/{key}/plan/action
   * @summary Resolve the plan review
   * @response 200 application/json Ack
   * @response 400 application/json Problem
   * @response 404 application/json Problem
   */
  resolvePlan(key: string, body: PlanActionRequest): Promise<Ack>;

  /**
   * Render markdown with `Bun.markdown.html`.
   *
   * The browser has no `Bun.markdown`, so every rendering in the UI —
   * transcript text, thinking blocks, the plan document — comes from here.
   *
   * @post /api/markdown
   * @summary Render markdown to HTML
   * @response 200 application/json RenderedMarkdown
   */
  renderMarkdown(body: MarkdownRequest): Promise<RenderedMarkdown>;
}
