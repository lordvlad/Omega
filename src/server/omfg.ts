/**
 * OMFG: Time-Traveling Stream Rule (TTSR) analysis and generation.
 *
 * When the user reports a recurring mistake, this analyzes the conversation
 * history, synthesizes a rule with regex conditions and scope, and formats
 * it for `.omp/rules/` (project) or `~/.omp/agent/rules/` (global).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OmfgAnalyzeRequest, OmfgRuleCandidate, OmfgSaveRequest } from "../shared/model.ts";
import type { LiveSession } from "./registry.ts";

const JSON_FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

/** Extract JSON from text that may be fenced with ```json. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  const match = JSON_FENCE_PATTERN.exec(trimmed);
  if (match?.[1]) {
    return match[1].trim();
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

/** Sanitize a rule name into valid kebab-case. */
export function sanitizeRuleName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
}

/** Format a rule candidate into standard YAML frontmatter markdown. */
export function formatRuleMarkdown(
  description: string,
  condition: string | string[],
  scope: string | string[] | undefined,
  body: string,
): string {
  const lines = ["---", `description: ${JSON.stringify(description)}`];

  if (Array.isArray(condition)) {
    if (condition.length === 1) {
      lines.push(`condition: ${JSON.stringify(condition[0])}`);
    } else {
      lines.push("condition:");
      for (const c of condition) {
        lines.push(`  - ${JSON.stringify(c)}`);
      }
    }
  } else if (condition) {
    lines.push(`condition: ${JSON.stringify(condition)}`);
  }

  if (scope) {
    if (Array.isArray(scope)) {
      if (scope.length === 1) {
        lines.push(`scope: ${JSON.stringify(scope[0])}`);
      } else {
        lines.push("scope:");
        for (const s of scope) {
          lines.push(`  - ${JSON.stringify(s)}`);
        }
      }
    } else {
      lines.push(`scope: ${JSON.stringify(scope)}`);
    }
  }

  lines.push("---", "", body.trim(), "");
  return lines.join("\n");
}

const OMFG_SYSTEM_PROMPT = `<omfg>
The user is frustrated about recurring agent behavior.
Author ONE Time Traveling Stream Rule (TTSR) that would have caught the offending behavior earlier in this conversation.

TTSR mechanics:
- A rule is a markdown file with YAML frontmatter.
- \`condition\` is one or more JavaScript regex patterns tested against assistant streamed output.
- \`scope\` is a comma-separated allowlist. If present, only listed streams are checked.
- \`text\` = assistant prose only. \`thinking\` = hidden reasoning summaries. \`tool\` = every tool's arguments.
- \`tool:<name>(<glob>)\` = one tool, only when path-like args match the glob. Examples: \`tool:write(*.rb)\`, \`tool:edit(*.ts)\`.
- SHOULD use file-specific tool scopes for code complaints.
- Output contract: Emit exactly one JSON object and nothing else with fields: \`name\`, \`description\`, \`condition\`, \`scope\`, \`body\`.
- \`name\` MUST be kebab-case.
- \`description\` MUST be a one-line summary.
- \`condition\` MUST be a string or string array of JavaScript regex patterns.
- \`scope\` MUST be a string or string array.
- \`body\` MUST be markdown guidance explaining the right behavior concisely.

Complaint:
{{complaint}}

{{#if feedback}}
Requested amendments:
{{feedback}}

Latest candidate JSON:
{{previousRule}}
{{/if}}
</omfg>`;

export async function analyzeOmfgRule(live: LiveSession, request: OmfgAnalyzeRequest): Promise<OmfgRuleCandidate> {
  const complaint = request.complaint.trim();
  if (!complaint) {
    throw new Error("Complaint is required for /omfg.");
  }

  let promptText = OMFG_SYSTEM_PROMPT.replace("{{complaint}}", complaint);
  if (request.feedback) {
    promptText = promptText
      .replace("{{feedback}}", request.feedback)
      .replace("{{previousRule}}", request.previousRule ?? "");
  } else {
    promptText = promptText.replace(/\{\{#if feedback\}\}[\s\S]*?\{\{\/if\}\}/, "");
  }

  const { replyText } = await live.session.runEphemeralTurn({ promptText, dedupeReply: false });

  let parsed: any;
  try {
    const jsonStr = extractJson(replyText);
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Model did not return valid JSON for rule candidate: ${replyText.slice(0, 200)}`);
  }

  const name = sanitizeRuleName(parsed.name || "custom-rule");
  const description = String(parsed.description || "Custom stream rule");
  const condition = Array.isArray(parsed.condition)
    ? parsed.condition.map(String)
    : [String(parsed.condition || "")].filter(Boolean);
  const scope = Array.isArray(parsed.scope)
    ? parsed.scope.map(String)
    : parsed.scope
      ? [String(parsed.scope)]
      : undefined;
  const body = String(parsed.body || "Follow project conventions.");

  const fileContent = formatRuleMarkdown(description, condition, scope, body);
  const cwd = live.manager.getCwd();
  const home = process.env.HOME || "/home/waldemar";

  return {
    name,
    description,
    condition,
    scope,
    body,
    fileContent,
    suggestedPath: {
      project: path.join(cwd, ".omp", "rules", `${name}.md`),
      global: path.join(home, ".omp", "agent", "rules", `${name}.md`),
    },
  };
}

export async function saveOmfgRule(
  live: LiveSession,
  request: OmfgSaveRequest,
): Promise<{ ok: boolean; detail: string; path: string }> {
  const name = sanitizeRuleName(request.name);
  if (!name) {
    throw new Error("Rule name is required.");
  }
  if (!request.fileContent.trim()) {
    throw new Error("Rule file content is empty.");
  }

  const cwd = live.manager.getCwd();
  const home = process.env.HOME || "/home/waldemar";
  const targetDir =
    request.scope === "global" ? path.join(home, ".omp", "agent", "rules") : path.join(cwd, ".omp", "rules");
  const filePath = path.join(targetDir, `${name}.md`);

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(filePath, request.fileContent, "utf8");

  return {
    ok: true,
    detail: `Saved rule "${name}" to ${request.scope} rules (${filePath}).`,
    path: filePath,
  };
}
