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
   * The session transcript, flattened into renderable parts.
   *
   * @get /api/sessions/{key}/transcript
   * @summary Read the session transcript
   * @response 200 application/json Transcript
   * @response 404 application/json Problem
   */
  getTranscript(key: string): Promise<Transcript>;

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
