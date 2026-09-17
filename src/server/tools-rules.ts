/**
 * Tool inspection, forced tool choices, and TTSR stream rule discovery.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  Ack,
  DeleteRuleRequest,
  ForceToolRequest,
  ListRulesResult,
  ListToolsResult,
  RuleScopeType,
  SessionRuleInfo,
  SessionToolInfo,
  ToolSource,
} from "../shared/model.ts";
import type { LiveSession } from "./registry.ts";

const BUILTIN_TOOL_NAMES = new Set([
  "read",
  "edit",
  "write",
  "bash",
  "grep",
  "glob",
  "task",
  "hub",
  "todo",
  "eval",
  "web_search",
]);

function classifyToolSource(name: string): ToolSource {
  if (name.startsWith("xd://") || name.startsWith("xd_")) return "xdev";
  if (name.startsWith("a2ui_")) return "custom";
  if (BUILTIN_TOOL_NAMES.has(name)) return "builtin";
  if (name.includes(":") || name.includes("__")) return "mcp";
  return "other";
}

/**
 * List all tools registered on the live session with active and forced status.
 */
export function listSessionTools(live: LiveSession): ListToolsResult {
  const activeNames = new Set(live.session.getActiveToolNames());
  const allNames = live.session.getAllToolNames();
  const allInfos = typeof live.session.getAllToolInfos === "function" ? live.session.getAllToolInfos() : [];
  const infoByName = new Map(allInfos.map(info => [info.name, info]));

  let forcedTool: string | undefined;
  try {
    forcedTool = (live.session as any).getForcedToolChoice?.() || undefined;
  } catch {
    forcedTool = undefined;
  }

  const tools: SessionToolInfo[] = [];

  for (const name of allNames) {
    const info = infoByName.get(name);
    const desc =
      info?.description || (name.startsWith("a2ui_") ? "A2UI protocol surface tool" : "Registered tool");
    const source = classifyToolSource(name);
    const active = activeNames.has(name);
    const forced = forcedTool === name;

    tools.push({
      name,
      description: desc,
      parameters: info?.parameters as Record<string, unknown> | undefined,
      source,
      active,
      forced,
    });
  }

  return {
    tools,
    forcedTool,
  };
}

/**
 * Force or clear tool choice for the session's next turn.
 */
export function forceSessionTool(live: LiveSession, request: ForceToolRequest): Ack {
  if (request.clear || !request.toolName) {
    try {
      (live.session as any).setForcedToolChoice?.(undefined);
    } catch {
      // ignore
    }
    return { ok: true, detail: "Cleared forced tool choice." };
  }

  const name = request.toolName.trim();
  live.session.setForcedToolChoice(name);
  return { ok: true, detail: `Next turn forced to use "${name}".` };
}

function parseRuleFrontmatter(
  filePath: string,
  content: string,
  scopeType: RuleScopeType,
): SessionRuleInfo | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("---")) return null;

  const endMarker = trimmed.indexOf("---", 3);
  if (endMarker === -1) return null;

  const header = trimmed.slice(3, endMarker);
  const body = trimmed.slice(endMarker + 3).trim();

  let description = "";
  const condition: string[] = [];
  const scope: string[] = [];

  for (const line of header.split("\n")) {
    const l = line.trim();
    if (l.startsWith("description:")) {
      description = l
        .slice("description:".length)
        .trim()
        .replace(/^["']|["']$/g, "");
    } else if (l.startsWith("condition:")) {
      const rest = l
        .slice("condition:".length)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (rest) condition.push(rest);
    } else if (l.startsWith("- ") || l.startsWith("  - ")) {
      const val = l
        .replace(/^[\s-]+/, "")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (val) condition.push(val);
    } else if (l.startsWith("scope:")) {
      const rest = l
        .slice("scope:".length)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (rest) scope.push(rest);
    }
  }

  const name = path.basename(filePath, ".md");

  return {
    name,
    description: description || "Stream rule",
    condition,
    scope: scope.length > 0 ? scope : undefined,
    body,
    filePath,
    scopeType,
    enabled: true,
  };
}

/**
 * Discover all stream rules (TTSR) across project and global rules directories.
 */
export async function listSessionRules(live: LiveSession): Promise<ListRulesResult> {
  const cwd = live.manager.getCwd();
  const home = process.env.HOME || "/home/waldemar";

  const projectRulesDir = path.join(cwd, ".omp", "rules");
  const globalRulesDir = path.join(home, ".omp", "agent", "rules");

  const rules: SessionRuleInfo[] = [];

  const readDirRules = async (dir: string, scopeType: RuleScopeType): Promise<void> => {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".md")) {
          const filePath = path.join(dir, file);
          const content = await fs.readFile(filePath, "utf8");
          const parsed = parseRuleFrontmatter(filePath, content, scopeType);
          if (parsed) rules.push(parsed);
        }
      }
    } catch {
      // Directory doesn't exist
    }
  };

  await readDirRules(projectRulesDir, "project");
  await readDirRules(globalRulesDir, "global");

  return { rules };
}

/**
 * Delete a rule file from disk.
 */
export async function deleteSessionRule(live: LiveSession, request: DeleteRuleRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) throw new Error("Rule name is required.");

  const cwd = live.manager.getCwd();
  const home = process.env.HOME || "/home/waldemar";

  const targetDir =
    request.scopeType === "global"
      ? path.join(home, ".omp", "agent", "rules")
      : path.join(cwd, ".omp", "rules");

  const filePath = path.join(targetDir, `${name}.md`);

  try {
    await fs.unlink(filePath);
    return { ok: true, detail: `Deleted rule "${name}" from ${request.scopeType} rules.` };
  } catch (err) {
    throw new Error(`Failed to delete rule "${name}": ${err instanceof Error ? err.message : String(err)}`);
  }
}
