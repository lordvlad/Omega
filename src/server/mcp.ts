/**
 * MCP server management and diagnostics.
 *
 * Uses omp's official SDK APIs (@oh-my-pi/pi-utils and @oh-my-pi/pi-coding-agent/mcp)
 * for reading/writing configuration files and testing live server connections.
 */
import { connectToServer, disconnectServer, listTools } from "@oh-my-pi/pi-coding-agent/mcp/client";
import {
  readDisabledServers,
  readMCPConfigFile,
  removeMCPServer,
  setServerDisabled,
  updateMCPServer,
} from "@oh-my-pi/pi-coding-agent/mcp/config-writer";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";
import { getMCPConfigPath } from "@oh-my-pi/pi-utils";
import type {
  Ack,
  AddMcpServerRequest,
  ListMcpServersResult,
  McpServerInfo,
  RemoveMcpServerRequest,
  TestMcpServerRequest,
  TestMcpServerResult,
  ToggleMcpServerRequest,
} from "../shared/model.ts";

/**
 * List all configured MCP servers using omp's official config paths and readers.
 */
export async function listAllMcpServers(cwd?: string): Promise<ListMcpServersResult> {
  const userPath = getMCPConfigPath("user", cwd);
  const projectPath = getMCPConfigPath("project", cwd);

  const [userConfig, projectConfig] = await Promise.all([
    readMCPConfigFile(userPath).catch(() => ({ mcpServers: {} })),
    readMCPConfigFile(projectPath).catch(() => ({ mcpServers: {} })),
  ]);

  const [userDisabled, projectDisabled] = await Promise.all([
    readDisabledServers(userPath).catch(() => [] as string[]),
    readDisabledServers(projectPath).catch(() => [] as string[]),
  ]);

  const userDisabledSet = new Set(userDisabled);
  const projectDisabledSet = new Set(projectDisabled);

  const servers: McpServerInfo[] = [];
  const seen = new Set<string>();

  // 1. Project-scoped servers (take precedence over global if names collide)
  for (const [name, rawConfig] of Object.entries(projectConfig.mcpServers ?? {})) {
    const config = rawConfig as MCPServerConfig;
    const isDisabled = config.enabled === false || projectDisabledSet.has(name);
    servers.push({
      name,
      scope: "project",
      status: isDisabled ? "disabled" : "configured",
      command: "command" in config ? config.command : undefined,
      args: "args" in config ? config.args : undefined,
      url: "url" in config ? config.url : undefined,
      env: "env" in config ? config.env : undefined,
      disabled: isDisabled,
    });
    seen.add(name);
  }

  // 2. Global/User-scoped servers
  for (const [name, rawConfig] of Object.entries(userConfig.mcpServers ?? {})) {
    const config = rawConfig as MCPServerConfig;
    const isDisabled = config.enabled === false || userDisabledSet.has(name);
    servers.push({
      name,
      scope: "global",
      status: isDisabled ? "disabled" : "configured",
      command: "command" in config ? config.command : undefined,
      args: "args" in config ? config.args : undefined,
      url: "url" in config ? config.url : undefined,
      env: "env" in config ? config.env : undefined,
      disabled: isDisabled,
    });
  }

  return { servers };
}

/**
 * Test connectivity and discover tools on an MCP server using omp's native client.
 */
export async function testMcpServerConnection(request: TestMcpServerRequest): Promise<TestMcpServerResult> {
  const name = request.name?.trim() || "default";
  const userPath = getMCPConfigPath("user", request.cwd);
  const projectPath = getMCPConfigPath("project", request.cwd);

  const [userConfig, projectConfig] = await Promise.all([
    readMCPConfigFile(userPath).catch(() => ({ mcpServers: {} })),
    readMCPConfigFile(projectPath).catch(() => ({ mcpServers: {} })),
  ]);

  const userServers = (userConfig.mcpServers ?? {}) as Record<string, MCPServerConfig>;
  const projectServers = (projectConfig.mcpServers ?? {}) as Record<string, MCPServerConfig>;

  let serverConfig: MCPServerConfig | undefined;

  if (request.scope === "project") {
    serverConfig = projectServers[name];
  } else if (request.scope === "global") {
    serverConfig = userServers[name];
  } else {
    serverConfig = projectServers[name] || userServers[name];
  }
  if (!serverConfig) {
    return {
      name,
      ok: false,
      latencyMs: 0,
      tools: [],
      error: `Server "${name}" not found in MCP configuration.`,
    };
  }

  const start = performance.now();
  try {
    const connection = await connectToServer(name, serverConfig, {
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = Math.round(performance.now() - start);

    let tools: string[] = [];
    try {
      const toolsResult = await listTools(connection);
      if (Array.isArray(toolsResult)) {
        tools = toolsResult.map((t) => t.name);
      }
    } catch {
      tools = [];
    } finally {
      await disconnectServer(connection).catch(() => {});
    }

    return {
      name,
      ok: true,
      latencyMs,
      tools,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      name,
      ok: false,
      latencyMs,
      tools: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Add or update an MCP server using omp's config-writer.
 */
export async function addMcpServerConfig(cwd: string | undefined, request: AddMcpServerRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) {
    throw new Error("Server name is required.");
  }

  const scope = request.scope === "global" ? "user" : "project";
  const configPath = getMCPConfigPath(scope, cwd);

  const serverConfig: Record<string, unknown> = {};
  if (request.command) {
    serverConfig.type = "stdio";
    serverConfig.command = request.command;
    if (request.args && request.args.length > 0) {
      serverConfig.args = request.args;
    }
    if (request.env && Object.keys(request.env).length > 0) {
      serverConfig.env = request.env;
    }
  } else if (request.url) {
    serverConfig.type = "http";
    serverConfig.url = request.url;
  } else {
    throw new Error("Provide either a command or a URL for the MCP server.");
  }

  await updateMCPServer(configPath, name, serverConfig as unknown as MCPServerConfig);
  return { ok: true, detail: `Added MCP server "${name}" to ${request.scope} config.` };
}

/**
 * Remove an MCP server using omp's config-writer.
 */
export async function removeMcpServerConfig(cwd: string | undefined, request: RemoveMcpServerRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) {
    throw new Error("Server name is required.");
  }

  const scope = request.scope === "global" ? "user" : "project";
  const configPath = getMCPConfigPath(scope, cwd);

  await removeMCPServer(configPath, name);
  return { ok: true, detail: `Removed MCP server "${name}" from ${request.scope} config.` };
}

/**
 * Enable or disable an MCP server in project or global config.
 */
export async function toggleMcpServerConfig(cwd: string | undefined, request: ToggleMcpServerRequest): Promise<Ack> {
  const name = request.name.trim();
  if (!name) {
    throw new Error("Server name is required.");
  }

  const scope = request.scope === "global" ? "user" : "project";
  const configPath = getMCPConfigPath(scope, cwd);

  await setServerDisabled(configPath, name, request.disabled);
  return {
    ok: true,
    detail: `Server "${name}" in ${request.scope ?? scope} config is now ${request.disabled ? "disabled" : "enabled"}.`,
  };
}
