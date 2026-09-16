/**
 * MCP server management and diagnostics.
 *
 * Reads and writes Model Context Protocol configurations in `.omp/mcp.json`
 * (project-level) and `~/.omp/mcp.json` (global-level).
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

import type {
  Ack,
  AddMcpServerRequest,
  ListMcpServersResult,
  McpServerInfo,
  McpServerScope,
  RemoveMcpServerRequest,
  TestMcpServerRequest,
  TestMcpServerResult,
} from "../shared/model.ts";

interface RawMcpConfig {
  mcpServers?: Record<
    string,
    {
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      transport?: "stdio" | "sse" | "http";
      disabled?: boolean;
    }
  >;
  disabledServers?: string[];
}

function getHomeDir(): string {
  return process.env.HOME || "/home/waldemar";
}

function getGlobalConfigPath(): string {
  return path.join(getHomeDir(), ".omp", "mcp.json");
}

function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, ".omp", "mcp.json");
}

async function readConfigFile(filePath: string): Promise<RawMcpConfig> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as RawMcpConfig;
  } catch {
    return { mcpServers: {}, disabledServers: [] };
  }
}

async function writeConfigFile(filePath: string, config: RawMcpConfig): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

/**
 * List all configured MCP servers across project and global configurations.
 */
export async function listAllMcpServers(cwd?: string): Promise<ListMcpServersResult> {
  const globalPath = getGlobalConfigPath();
  const globalConfig = await readConfigFile(globalPath);

  const servers: McpServerInfo[] = [];

  const addServersFromConfig = (config: RawMcpConfig, scope: McpServerScope): void => {
    const disabledSet = new Set(config.disabledServers ?? []);
    for (const [name, def] of Object.entries(config.mcpServers ?? {})) {
      const isDisabled = def.disabled === true || disabledSet.has(name);
      servers.push({
        name,
        scope,
        status: isDisabled ? "disabled" : "configured",
        command: def.command,
        args: def.args,
        url: def.url,
        env: def.env,
        disabled: isDisabled,
      });
    }
  };

  // Add global servers
  addServersFromConfig(globalConfig, "global");

  // Add project servers if cwd is provided
  if (cwd) {
    const projectPath = getProjectConfigPath(cwd);
    const projectConfig = await readConfigFile(projectPath);
    addServersFromConfig(projectConfig, "project");

    // Also check standalone mcp.json / .mcp.json fallback in project root
    for (const fallbackFile of ["mcp.json", ".mcp.json"]) {
      const fallbackPath = path.join(cwd, fallbackFile);
      const fallbackConfig = await readConfigFile(fallbackPath);
      for (const [name, def] of Object.entries(fallbackConfig.mcpServers ?? {})) {
        if (!servers.some(s => s.name === name)) {
          servers.push({
            name,
            scope: "project",
            status: def.disabled ? "disabled" : "configured",
            command: def.command,
            args: def.args,
            url: def.url,
            env: def.env,
            disabled: def.disabled,
          });
        }
      }
    }
  }

  return { servers };
}

/**
 * Test connectivity to an MCP server.
 */
export async function testMcpServerConnection(request: TestMcpServerRequest): Promise<TestMcpServerResult> {
  const name = request.name?.trim() || "default";
  const start = performance.now();

  const list = await listAllMcpServers(request.cwd);
  const server = list.servers.find(s => s.name === name && (!request.scope || s.scope === request.scope));

  if (!server) {
    return {
      name,
      ok: false,
      latencyMs: 0,
      tools: [],
      error: `Server "${name}" is not configured.`,
    };
  }

  if (server.url) {
    const url = server.url;
    try {
      const t0 = performance.now();
      const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) }).catch(() =>
        fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) }),
      );
      const latencyMs = Math.round(performance.now() - t0);
      return {
        name,
        ok: res.ok || res.status === 405 || res.status === 404,
        latencyMs,
        tools: [],
      };
    } catch (err) {
      return {
        name,
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  if (server.command) {
    // For command-based servers, verify command exists on PATH
    try {
      const proc = Bun.spawn(["which", server.command], { stdout: "pipe", stderr: "pipe" });
      const exitCode = await proc.exited;
      const latencyMs = Math.round(performance.now() - start);
      if (exitCode === 0) {
        return {
          name,
          ok: true,
          latencyMs,
          tools: [],
        };
      }
      return {
        name,
        ok: false,
        latencyMs,
        tools: [],
        error: `Command "${server.command}" not found on PATH.`,
      };
    } catch (err) {
      return {
        name,
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        tools: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return {
    name,
    ok: true,
    latencyMs: Math.round(performance.now() - start),
    tools: [],
  };
}

/**
 * Add or update an MCP server configuration.
 */
export async function addMcpServerConfig(
  cwd: string | undefined,
  request: AddMcpServerRequest,
): Promise<Ack> {
  const name = request.name.trim();
  if (!name) throw new Error("Server name is required.");

  const targetPath =
    request.scope === "project" ? getProjectConfigPath(cwd || process.cwd()) : getGlobalConfigPath();

  const config = await readConfigFile(targetPath);
  config.mcpServers ??= {};

  config.mcpServers[name] = {
    command: request.command?.trim() || undefined,
    args: request.args,
    url: request.url?.trim() || undefined,
    env: request.env,
  };

  await writeConfigFile(targetPath, config);
  return { ok: true, detail: `Added MCP server "${name}" to ${request.scope} config.` };
}

/**
 * Remove an MCP server from configuration.
 */
export async function removeMcpServerConfig(
  cwd: string | undefined,
  request: RemoveMcpServerRequest,
): Promise<Ack> {
  const name = request.name.trim();
  if (!name) throw new Error("Server name is required.");

  const targetPath =
    request.scope === "project" ? getProjectConfigPath(cwd || process.cwd()) : getGlobalConfigPath();

  const config = await readConfigFile(targetPath);
  if (config.mcpServers?.[name]) {
    delete config.mcpServers[name];
    if (config.disabledServers) {
      config.disabledServers = config.disabledServers.filter(s => s !== name);
    }
    await writeConfigFile(targetPath, config);
    return { ok: true, detail: `Removed MCP server "${name}" from ${request.scope} config.` };
  }

  return { ok: true, detail: `Server "${name}" was not in ${request.scope} config.` };
}
