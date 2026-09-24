/**
 * The planning surface: the plan document, its headings, and the four
 * decisions omp's plan review offers.
 *
 * The approval branches mirror `InteractiveMode.#approvePlan`: exit plan mode,
 * optionally reshape the context, restore the execution tool set with `read`
 * forced on, pin the plan reference, apply the chosen role tier, then dispatch
 * omp's own `plan-mode-approved` prompt. The prompt template is read from the
 * installed package rather than paraphrased, so the executing model gets the
 * same directive it gets in the terminal.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { resolveLocalUrlToPath } from "@oh-my-pi/pi-coding-agent/internal-urls";
import { prompt as promptUtil } from "@oh-my-pi/pi-utils";
import type { PlanActionRequest, PlanDocument, PlanSection } from "../shared/model.ts";
import type { LiveSession, Registry } from "./registry.ts";

/**
 * Percent of the context window above which omp disables its keep-context
 * option (matching omp's PLAN_KEEP_CONTEXT_DISABLE_THRESHOLD_PERCENT = 95).
 */
const KEEP_CONTEXT_LIMIT = 95;

/** omp's approved-plan directive, read once from the installed package. */
let approvedTemplate: Promise<string> | undefined;

function planApprovedTemplate(): Promise<string> {
  approvedTemplate ??= (async () => {
    const entry = Bun.resolveSync("@oh-my-pi/pi-coding-agent", process.cwd());
    const file = path.join(path.dirname(entry), "prompts/system/plan-mode-approved.md");
    return Bun.file(file).text();
  })();
  return approvedTemplate;
}

/** Absolute path of a `local://` plan URL within a session's artifact root. */
export function resolvePlanPath(live: LiveSession, planFilePath: string): string {
  if (!planFilePath.startsWith("local:")) {
    return path.isAbsolute(planFilePath) ? planFilePath : path.resolve(live.manager.getCwd(), planFilePath);
  }
  return resolveLocalUrlToPath(planFilePath, {
    getArtifactsDir: () => live.manager.getArtifactsDir(),
    getSessionId: () => live.manager.getSessionId(),
  });
}

/**
 * Headings of a markdown document, in order.
 *
 * Fenced blocks are tracked so a `#` comment inside a shell or python sample
 * does not become a table-of-contents entry.
 */
export function planSections(content: string): PlanSection[] {
  const sections: PlanSection[] = [];
  const seen = new Set<string>();
  let fence: string | undefined;

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === undefined) {
        fence = marker[0];
      } else if (marker[0] === fence) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/u.exec(line);
    if (!heading) {
      continue;
    }
    const level = heading[1]?.length ?? 1;
    const title = (heading[2] ?? "").trim();
    if (!title) {
      continue;
    }

    // Slugs are scroll anchors, so a document with two identically named
    // sections still gets two distinct targets.
    const base =
      title
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/gu, "") || `section-${index}`;
    let slug = base;
    let suffix = 2;
    while (seen.has(slug)) {
      slug = `${base}-${suffix++}`;
    }
    seen.add(slug);

    sections.push({ id: slug, title, level, line: index });
  }
  return sections;
}

/**
 * Inject the table-of-contents anchor ids into rendered plan HTML.
 *
 * `Bun.markdown.html` emits bare `<h2>…</h2>`, so the ids the left-hand TOC
 * scrolls to are added here, in the same document order `planSections`
 * produced them.
 */
export function anchorHeadings(html: string, sections: PlanSection[]): string {
  let cursor = 0;
  return html.replace(/<h([1-6])>/gu, (match, level: string) => {
    // Match by depth: the renderer emits headings in source order, so the
    // next heading of this depth is this section.
    while (cursor < sections.length && sections[cursor]?.level !== Number(level)) {
      cursor++;
    }
    const section = sections[cursor];
    if (!section) {
      return match;
    }
    cursor++;
    return `<h${level} id="${section.id}">`;
  });
}

/** Build the payload the three planning panes render. */
export async function planDocument(live: LiveSession): Promise<PlanDocument> {
  const state = live.planState();
  const planFilePath = state?.planFilePath ?? live.session.getPlanReferencePath() ?? "";
  let content = "";
  if (planFilePath) {
    content = await Bun.file(resolvePlanPath(live, planFilePath))
      .text()
      .catch(() => "");
  }
  const sections = planSections(content);
  const usage = live.session.getContextUsage();
  return {
    enabled: state?.enabled === true,
    planFilePath,
    title: state?.title,
    awaitingApproval: state?.awaitingApproval === true,
    content,
    html: content ? anchorHeadings(Bun.markdown.html(content), sections) : "",
    sections,
    tiers: live.tiers(),
    keepContextDisabled: usage ? usage.percent >= KEEP_CONTEXT_LIMIT : false,
  };
}

/** Persist a hand-edited plan document. */
export async function writePlan(live: LiveSession, content: string): Promise<void> {
  const state = live.planState();
  const planFilePath = state?.planFilePath ?? live.session.getPlanReferencePath();
  if (!planFilePath) {
    throw new Error("No plan document to edit.");
  }
  const target = resolvePlanPath(live, planFilePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await Bun.write(target, content);
}

/** Outcome of a plan decision. */
export interface PlanResolution {
  detail: string;
  /** Present when execution moved to a fresh session. */
  sessionKey?: string;
}

/**
 * Apply one plan decision.
 *
 * `refine` leaves plan mode on and re-prompts. The three approval branches
 * leave plan mode and dispatch execution; `execute` does so in a fresh
 * session, which is how omp spells `preserveContext: false`.
 */
export async function resolvePlan(
  registry: Registry,
  live: LiveSession,
  request: PlanActionRequest,
): Promise<PlanResolution> {
  const pending = live.pendingPlan;
  const planFilePath = pending?.planFilePath ?? live.session.getPlanReferencePath();
  if (!planFilePath) {
    throw new Error("No plan has been proposed.");
  }

  if (request.action === "refine") {
    const feedback = request.feedback?.trim();
    if (!feedback) {
      throw new Error("Refine needs feedback for the model.");
    }
    // Release the proposal first: the agent is parked inside its `xd://propose`
    // call, and it cannot accept a new turn until that returns.
    live.settlePlan();
    live.session.setPlanModeState(live.session.getPlanModeState());
    void live.session.prompt(feedback).catch((error) => {
      live.emitCustom({
        type: "RUN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return { detail: "Sent refinements to the planner." };
  }

  const content = await Bun.file(resolvePlanPath(live, planFilePath))
    .text()
    .catch(() => "");
  if (!content) {
    throw new Error(`Plan file not found at ${planFilePath}`);
  }

  // Leaving plan mode restores write access and stops the plan-mode system
  // prompt from being rebuilt into the next turn.
  live.session.setPlanProposalHandler(null);
  live.session.setPlanModeState(undefined);
  live.manager.appendModeChange("none");
  live.settlePlan();

  const title = pending?.title ?? path.basename(planFilePath).replace(/-plan\.md$/u, "");
  const target = request.action === "execute" ? await forkForExecution(registry, live, planFilePath, content) : live;

  if (request.action === "compact") {
    // Distil the planning transcript so the approved-plan prompt lands as a
    // fresh cache anchor rather than behind the whole exploration.
    await live.session.compact().catch(() => undefined);
  }

  // Approved plans require reading the durable artifact, so `read` is forced
  // on regardless of what plan mode left enabled.
  const tools = target.session.getEnabledToolNames();
  await target.session.setActiveToolsByName(tools.includes("read") ? tools : [...tools, "read"]);
  target.session.setPlanReferencePath(planFilePath);

  await applyTier(target, request.tier);

  const seeded = title.replace(/[-_]+/gu, " ").trim();
  if (seeded && !target.manager.getSessionName()) {
    await target.manager.setSessionName(seeded.charAt(0).toUpperCase() + seeded.slice(1), "auto");
  }

  target.session.markPlanReferenceSent();
  const directive = promptUtil.render(await planApprovedTemplate(), {
    // An absolute path: the executing session may be a different one, whose
    // `local://` root is not where this plan was written.
    planFilePath: resolvePlanPath(target, planFilePath),
    contextPreserved: request.action !== "execute",
  });

  if (target.session.isStreaming) {
    void target.session.followUp(directive, undefined, { synthetic: true });
  } else {
    void target.session.prompt(directive, { synthetic: true }).catch((error) => {
      target.emitCustom({
        type: "RUN_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }
  return {
    detail:
      request.action === "execute"
        ? "Plan approved; executing in a fresh session."
        : request.action === "compact"
          ? "Plan approved; context compacted and executing."
          : "Plan approved; executing with the planning context.",
    sessionKey: target === live ? undefined : target.key,
  };
}

/**
 * Start a fresh session for execution and copy the plan artifact into it.
 *
 * This is omp's `preserveContext: false` path: the planning transcript is left
 * behind, but the plan file has to travel, because the approved-plan directive
 * tells the model to read it.
 */
async function forkForExecution(
  registry: Registry,
  live: LiveSession,
  planFilePath: string,
  content: string,
): Promise<LiveSession> {
  const fresh = await registry.open({ cwd: live.manager.getCwd() });
  const target = resolvePlanPath(fresh, planFilePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await Bun.write(target, content);
  return fresh;
}

/** Switch the executing session to the chosen role tier. */
async function applyTier(target: LiveSession, role: string | undefined): Promise<void> {
  if (!role) {
    return;
  }
  const cycle = target.session.getRoleModelCycle(["smol", "default", "slow"]);
  const entry = cycle?.models.find((candidate) => candidate.role === role);
  if (entry) {
    await target.session.applyRoleModel(entry);
  }
}
