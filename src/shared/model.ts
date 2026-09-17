/**
 * Wire types for the omega web UI.
 *
 * These declarations are the single source of truth: `src/shared/schema.ts`
 * turns them into an OpenAPI document at compile time, and
 * `bun run gen:api` turns that document into the react-query client the
 * browser imports. A field renamed here is a type error in both the server
 * handler and the component that reads it, never a stale document.
 */

/** A directory that has at least one omp session on disk. */
export interface Workspace {
  /** Absolute working directory the sessions were started in. */
  cwd: string;
  /** Last path segment, for display. */
  name: string;
  /** Sessions started in this directory, newest first. */
  sessions: SessionSummary[];
  /** Most recent `modified` across `sessions`, ISO-8601. */
  modified: string;
  /** True when the directory still exists on disk. */
  exists: boolean;
}

/**
 * Coarse lifecycle status of a persisted session, mirroring omp's own
 * `SessionStatus` union so the badge in the UI means what omp means.
 */
export type SessionStatus = "complete" | "interrupted" | "aborted" | "error" | "pending" | "unknown";

/** One persisted session, as listed from disk without loading its transcript. */
export interface SessionSummary {
  /** Absolute path of the `.jsonl` session file. */
  path: string;
  /** omp session UUID. */
  id: string;
  cwd: string;
  /** Generated or user-set session title; absent for untitled sessions. */
  title?: string;
  /** ISO-8601. */
  created: string;
  /** ISO-8601. */
  modified: string;
  messageCount: number;
  /** Session file size in bytes. */
  size: number;
  /** First user message, truncated for preview. */
  firstMessage: string;
  status: SessionStatus;
  /** True when this session is currently loaded as a live agent in the server. */
  live: boolean;
}

/** A model the local omp install is authenticated for. */
export interface ModelOption {
  provider: string;
  id: string;
  name: string;
  /** `provider/id`, the stable value used by the selector. */
  ref: string;
  /** True when the model supports a thinking/reasoning budget. */
  reasoning: boolean;
  contextWindow: number;
}

/** omp thinking levels, in ascending order of budget. */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Context-window consumption for the live session. */
export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  /** Fraction consumed, 0..1. */
  percent: number;
}

/** Everything the chat header and composer need about a live session. */
export interface LiveState {
  /**
   * omp session UUID — the key for every other session route. A UUID rather
   * than the session's file path so it needs no escaping in a path segment.
   */
  key: string;
  /** Absolute path of the `.jsonl` session file backing this session. */
  sessionFile: string;
  cwd: string;
  title?: string;
  /** `provider/id` of the active model. */
  model: string;
  modelName: string;
  thinkingLevel: ThinkingLevel;
  /** True while a turn is in flight. */
  streaming: boolean;
  /** Messages queued behind the active turn. */
  queued: number;
  contextUsage?: ContextUsage;
  /** Plan mode state, when plan mode is enabled. */
  plan?: PlanState;
  /** Phases and tasks tracked by the session's todo tool. */
  todos?: TodoPhase[];
  /** Sub-agent tasks spawned during this session. */
  subagents?: SubagentTask[];
  /**
   * Why the last turn stopped without finishing, if it did.
   *
   * The socket reports a failure once, to whoever is listening at the time.
   * A reload is a new listener, so the reason has to live somewhere a fresh
   * page can ask for it — otherwise the conversation simply stops mid-turn
   * and the UI has nothing to say about why. Cleared when the next turn
   * starts.
   */
  lastError?: string;
}

/** Lifecycle status of a task in the todo list. */
export type TodoTaskStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

/** A single tracked task. */
export interface TodoTask {
  content: string;
  status: TodoTaskStatus;
  /** Note explaining what the task is blocked on. */
  blocker?: string;
}

/** A logical grouping of tasks in the todo list. */
export interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}
/** Lifecycle status of a spawned subagent. */
export type SubagentStatus = "running" | "completed" | "failed" | "aborted";

/** A subagent task spawned by the session. */
export interface SubagentTask {
  id: string;
  agent: string;
  description?: string;
  status: SubagentStatus;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

/** Plan-mode status carried alongside live session state. */
export interface PlanState {
  enabled: boolean;
  /** `local://<slug>-plan.md` the agent is writing. */
  planFilePath: string;
  /** True once a plan has been submitted for review via `xd://propose`. */
  awaitingApproval: boolean;
  /** Resolved plan title, present once proposed. */
  title?: string;
}

/** One heading in the plan document, for the left-hand table of contents. */
export interface PlanSection {
  /** Stable slug, used as the scroll anchor id. */
  id: string;
  /** Heading text without leading `#`. */
  title: string;
  /** Heading depth, 1..6. */
  level: number;
  /** 0-based line offset of the heading within the plan source. */
  line: number;
}

/** The plan document plus everything the three planning panes render. */
export interface PlanDocument {
  enabled: boolean;
  planFilePath: string;
  title?: string;
  awaitingApproval: boolean;
  /** Raw markdown source, empty when the agent has not written a plan yet. */
  content: string;
  /** `Bun.markdown.html` rendering of `content`. */
  html: string;
  /** Headings of `content`, in document order. */
  sections: PlanSection[];
  /** Role tiers the plan may be executed with, for the actions panel. */
  tiers: PlanTier[];
  /**
   * True when approving with the planning context intact would not fit the
   * model's context window. omp disables its keep-context option in exactly
   * this case, so the actions panel disables `keep` too.
   */
  keepContextDisabled: boolean;
}

/** One configured role model the approved plan can be executed with. */
export interface PlanTier {
  /** Configured role: `smol`, `default`, `slow`, … */
  role: string;
  /** `provider/id`. */
  ref: string;
  name: string;
}

/**
 * The four decisions omp's plan review offers, matching the option list in
 * `InteractiveMode.handlePlanApproval` one-for-one.
 *
 * - `execute` — "Approve and execute": `preserveContext: false`, so execution
 *   starts from a fresh context seeded with the plan artifact.
 * - `compact` — "Approve and compact context": distill the planning transcript,
 *   then execute.
 * - `keep` — "Approve and keep context": execute with the planning transcript
 *   intact. omp disables this when the context is already too full.
 * - `refine` — "Refine plan": stay in plan mode and re-prompt the model with
 *   `feedback`.
 */
export type PlanAction = "execute" | "compact" | "keep" | "refine";

/** A transcript entry, flattened for rendering. */
export interface TranscriptMessage {
  /** Render key, unique within a transcript. */
  id: string;
  role: "user" | "assistant" | "toolResult" | "custom";
  /** Ordered content parts. */
  parts: MessagePart[];
  /** ISO-8601, when the entry carried one. */
  timestamp?: string;
  /**
   * The omp session entry this message was written as.
   *
   * Present on persisted user messages, which are the only entries omp will
   * branch from. Absent on assistant messages, on anything still streaming,
   * and on the local echo of a message the server has not stored yet — so its
   * presence is exactly the test for whether a branch can start here.
   */
  entryId?: string;
}

/**
 * One renderable piece of a message. `text` and `thinking` carry markdown in
 * `text`; `toolCall` carries the call; `toolResult` carries its outcome;
 * `error` carries why the turn stopped.
 */
export interface MessagePart {
  kind: "text" | "thinking" | "toolCall" | "toolResult" | "error";
  /** Markdown source for `text`/`thinking`, rendered output for tool parts. */
  text: string;
  /** Tool name, for `toolCall`/`toolResult`. */
  toolName?: string;
  /** omp tool call id, correlating a call with its result. */
  toolCallId?: string;
  /** JSON-encoded arguments, for `toolCall`. */
  args?: string;
  /** True when a `toolResult` reported failure. */
  isError?: boolean;
}

/**
 * What slice of a transcript to read, and what to leave out of it.
 *
 * Filtering is a server concern, not a display toggle applied after the fact:
 * hidden thinking and tool output are the bulk of a long session's bytes, and
 * a browser that is never going to draw them should not be sent them.
 */
export interface TranscriptQuery {
  /**
   * Newest messages to return. Defaults to 1000, which is what one page of
   * this UI renders without virtualisation.
   *
   * Older history is read by asking for a larger window rather than by
   * walking a cursor: the window is the whole tail of the conversation, so
   * one request describes what is on screen and a reload reproduces it.
   *
   * @minimum 1
   * @maximum 20000
   */
  limit?: number;
  /** Include the agent's thinking blocks. Default true. */
  thinking?: boolean;
  /** Include tool calls and their results. Default true. */
  toolCalls?: boolean;
}

/** A transcript window: the newest `limit` messages, and whether older exist. */
export interface Transcript {
  key: string;
  messages: TranscriptMessage[];
  /** True when messages older than the first one here were left out. */
  hasMore: boolean;
}

/**
 * Rendered markdown, produced on the server by `Bun.markdown.react` and React
 * SSR. One entry per requested text, in request order.
 */
export interface RenderedMarkdown {
  html: string[];
}

/**
 * Markdown to render.
 *
 * A batch rather than a single string: a transcript mounts hundreds of parts
 * at once, and one request per part is hundreds of round trips for work the
 * server does in microseconds.
 */
export interface MarkdownRequest {
  texts: string[];
}

/** Which session to load as a live agent. */
export interface OpenSessionRequest {
  /** Absolute `.jsonl` path of an existing session. Omit to start a new one. */
  sessionPath?: string;
  /** Working directory for a new session. Required when `sessionPath` is absent. */
  cwd?: string;
}

/**
 * A file sent along with a message.
 *
 * omp takes images as a first-class attachment, so those reach the model as
 * images. It has no channel for anything else, so a text file is inlined into
 * the message instead, and a binary one is refused rather than turned into a
 * wall of base64 nobody can read.
 */
export interface Attachment {
  name: string;
  /** IANA type as the browser reported it, e.g. `image/png`, `text/plain`. */
  mimeType: string;
  /** File bytes, base64, without a `data:` prefix. */
  data: string;
}

/** A message to send to the agent. */
export interface PromptRequest {
  message: string;
  /**
   * How to deliver while a turn is already streaming. `steer` interrupts,
   * `followUp` queues for after the turn. Ignored when the session is idle.
   */
  deliverAs?: "steer" | "followUp";
  /** Files sent with this message. */
  attachments?: Attachment[];
  /**
   * Client-generated id for this send, used to make delivery exactly-once.
   *
   * The browser keeps an outbox so a message typed with no network survives
   * a closed tab, which makes retries inevitable: a send can succeed after
   * the outbox snapshot that still lists it, and be replayed by whoever
   * restores that snapshot. The server remembers recent ids per session and
   * answers a repeat without prompting the agent again, so "retry until it
   * lands" cannot turn into the same message twice.
   */
  idempotencyKey?: string;
}

/** Ask a transient side question without polluting session history. */
export interface BtwRequest {
  question: string;
}

/** Answer to an ephemeral side question. */
export interface BtwResult {
  answer: string;
}

/** Analyze a mistake from the previous turn and synthesize a TTSR rule. */
export interface OmfgAnalyzeRequest {
  complaint: string;
  feedback?: string;
  previousRule?: string;
}

/** A synthesized rule candidate. */
export interface OmfgRuleCandidate {
  name: string;
  description: string;
  condition: string[];
  scope?: string[];
  body: string;
  fileContent: string;
  suggestedPath: {
    project: string;
    global: string;
  };
}

/** Save a generated rule into project or global rules directory. */
export interface OmfgSaveRequest {
  name: string;
  fileContent: string;
  scope: "project" | "global";
}

/** MCP server transport type. */
export type McpServerTransport = "stdio" | "sse" | "http";

/** MCP configuration scope. */
export type McpServerScope = "project" | "global";

/** MCP server connection / operational status. */
export type McpServerStatus = "connected" | "disabled" | "configured" | "error";

/** Information about a configured MCP server. */
export interface McpServerInfo {
  name: string;
  scope: McpServerScope;
  status: McpServerStatus;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
  toolsCount?: number;
  error?: string;
}

/** List of configured MCP servers. */
export interface ListMcpServersResult {
  servers: McpServerInfo[];
}

/** Add or update an MCP server. */
export interface AddMcpServerRequest {
  name: string;
  scope: McpServerScope;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  cwd?: string;
}

/** Remove an MCP server. */
export interface RemoveMcpServerRequest {
  name: string;
  scope: McpServerScope;
  cwd?: string;
}
/** Test connection to an MCP server. */
export interface TestMcpServerRequest {
  name?: string;
  scope?: McpServerScope;
  cwd?: string;
}

/** Outcome of testing an MCP server connection. */
export interface TestMcpServerResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  tools: string[];
  error?: string;
}

/** Query parameters for listing MCP servers. */
export interface ListMcpServersQuery {
  cwd?: string;
}

/** Dismiss an A2UI surface from the session. */
export interface A2uiDismissRequest {
  surfaceId: string;
}

/** Source category of an available tool. */
export type ToolSource = "builtin" | "custom" | "mcp" | "xdev" | "other";

/** Information about a tool registered in the session. */
export interface SessionToolInfo {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  source: ToolSource;
  active: boolean;
  forced?: boolean;
}

/** List of tools available to the session. */
export interface ListToolsResult {
  tools: SessionToolInfo[];
  forcedTool?: string;
}

/** Force or clear tool choice for the next turn. */
export interface ForceToolRequest {
  toolName?: string;
  clear?: boolean;
}

/** Scope level of a TTSR rule. */
export type RuleScopeType = "project" | "global";

/** Information about a discovered stream rule (TTSR). */
export interface SessionRuleInfo {
  name: string;
  description: string;
  condition: string[];
  scope?: string[];
  body: string;
  filePath: string;
  scopeType: RuleScopeType;
  enabled?: boolean;
}

/** List of active/discovered stream rules. */
export interface ListRulesResult {
  rules: SessionRuleInfo[];
}

/** Delete a rule from disk. */
export interface DeleteRuleRequest {
  name: string;
  scopeType: RuleScopeType;
}

/** Model to switch the live session to. */
export interface SelectModelRequest {
  /** `provider/id`, as returned in `ModelOption.ref`. */
  ref: string;
  thinkingLevel?: ThinkingLevel;
}

/** Whether plan mode should be on. */
export interface PlanModeRequest {
  enabled: boolean;
}

/** A decision from the plan actions panel. */
export interface PlanActionRequest {
  action: PlanAction;
  /**
   * Section annotations and free-text notes re-prompted to the model.
   * Required by `refine`, ignored otherwise.
   */
  feedback?: string;
  /** Role tier to execute the approved plan with; defaults to `default`. */
  tier?: string;
}

/** A hand-edited plan document. */
export interface PlanEditRequest {
  content: string;
}

/** One-off compaction mode, mirroring omp's `/compact` subcommands. */
export type CompactMode = "soft" | "remote" | "snapcompact";

/** A manual context compaction. */
export interface CompactRequest {
  /** Omitted uses the session's configured method order. */
  mode?: CompactMode;
  /** Free-text focus for the summary. Rejected with `snapcompact`, which writes no summary. */
  focus?: string;
}

/** Which heavy content to drop from context. */
export type ShakeMode = "elide" | "images";

/** A context shake. */
export interface ShakeRequest {
  mode: ShakeMode;
}

/** Thinking level for the live session. */
export interface ThinkingRequest {
  level: ThinkingLevel;
}

/** A new display name for the session. */
export interface RenameRequest {
  title: string;
}

/** A user message a branch can start from. */
export interface BranchPoint {
  /** omp entry id of the user message. */
  entryId: string;
  /** Message preview, truncated for the picker. */
  text: string;
}

/** Which message to branch from. */
export interface BranchRequest {
  entryId: string;
}

/** A branch: the re-keyed session plus the message text to re-edit. */
export interface BranchResult {
  state: LiveState;
  /** Full text of the message branched from, for pre-filling the composer. */
  draft: string;
}

/**
 * A slash command an MCP server contributes to this session.
 *
 * These are omp's own: a connected server publishes prompts, omp turns each
 * into a `/name` command, and expands it when a message starting with that
 * name is sent. Nothing here executes anything — the list exists so the
 * palette can show what the session actually has, rather than leaving it to
 * be discovered by guessing.
 */
export interface SlashCommand {
  /** Command word without its leading slash, e.g. `github:review`. */
  name: string;
  /** One-line description, as the server published it. */
  description: string;
}

/**
 * Which queue a message waits in.
 *
 * `steer` messages interrupt the turn at its next step; `followUp` messages
 * wait for it to finish. omp keeps them as two ordered lanes, and a message
 * cannot move between them without being re-sent.
 */
export type QueueLane = "steer" | "followUp";

/** A user message waiting its turn. */
export interface QueuedMessage {
  lane: QueueLane;
  /** Position among the user messages of its lane, oldest first. */
  index: number;
  text: string;
}

/**
 * Rewrite one queued message.
 *
 * `expected` is the text the client last saw at this position. The agent
 * drains the queue on its own schedule, so a position alone is not a safe
 * handle: if the text no longer matches, the queue moved and the edit is
 * refused rather than applied to whatever slid into the slot.
 */
export interface QueueEditRequest {
  lane: QueueLane;
  index: number;
  expected: string;
  text: string;
}

/** Drop one queued message before it is ever delivered. */
export interface QueueDropRequest {
  lane: QueueLane;
  index: number;
  expected: string;
}

/** An operation that reports only success. */
export interface Ack {
  ok: boolean;
  /** Human-readable detail, for surfacing in a notification. */
  detail?: string;
  /**
   * Session the caller should switch to. Set by the `execute` plan action,
   * which runs the approved plan in a fresh session.
   */
  sessionKey?: string;
}

/** A failed request. */
export interface Problem {
  /** HTTP status. */
  status: number;
  /** Human-readable explanation. */
  detail: string;
}

/** Query parameters for listing workspace files. */
export interface ListFilesQuery {
  /** Workspace cwd to list files from. Defaults to the current project or server cwd. */
  cwd?: string;
}

/** A file path in the workspace. */
export type WorkspaceFile = string;

/** Query parameters for reading workspace git status. */
export interface GitStatusQuery {
  /** Workspace cwd to query git status from. Defaults to the current project or server cwd. */
  cwd?: string;
}

/** Git change classification for a single workspace file. */
export interface GitFileStatus {
  /** Normalized relative file path in the workspace. */
  path: string;
  /** Prior file path when renamed. */
  origPath?: string;
  /** High-level change status. */
  status: "modified" | "untracked" | "added" | "deleted" | "renamed" | "copied" | "conflict" | "ignored";
  /** Single-character marker (e.g. M, U, A, D, R, C, !). */
  marker: string;
  /** True if change has staged modifications in the index. */
  staged: boolean;
  /** True if change has unstaged modifications in the working tree. */
  unstaged: boolean;
}

/** Summary of git workspace status. */
export interface GitStatusResult {
  /** Current git branch name or `(detached)`. */
  branch?: string;
  /** True when no tracked or untracked changes exist. */
  clean: boolean;
  /** Map of relative file paths to their git status. */
  files: Record<string, GitFileStatus>;
}

/** Query parameters for reading file content. */
export interface ReadFileQuery {
  /** Relative path of the file to read. */
  path: string;
  /** Workspace cwd to read from. Defaults to current project or server cwd. */
  cwd?: string;
}

/** File content and metadata. */
export interface ReadFileResult {
  /** Normalized relative file path. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Inferred MIME type. */
  mimeType: string;
  /** True for non-text binary files. */
  isBinary: boolean;
  /** True for image formats. */
  isImage: boolean;
  /** Text content for readable text/code files. */
  content?: string;
  /** Data URL for image rendering. */
  dataUrl?: string;
}
