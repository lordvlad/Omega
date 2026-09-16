/**
 * MCP panel: manage and test Model Context Protocol (MCP) servers.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Collapse,
  Group,
  Loader,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCheck,
  IconPlugConnected,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import React, { useState } from "react";

import type {
  AddMcpServerRequest,
  McpServerInfo,
  McpServerScope,
  RemoveMcpServerRequest,
  TestMcpServerRequest,
  TestMcpServerResult,
} from "../api/model.ts";

export interface McpPanelProps {
  servers: McpServerInfo[];
  loading?: boolean;
  onAddServer: (req: AddMcpServerRequest) => Promise<void>;
  onRemoveServer: (req: RemoveMcpServerRequest) => Promise<void>;
  onTestServer: (req: TestMcpServerRequest) => Promise<TestMcpServerResult>;
  onRefresh?: () => void;
  onClose?: () => void;
}

export function McpPanel({
  servers,
  loading = false,
  onAddServer,
  onRemoveServer,
  onTestServer,
  onRefresh,
  onClose,
}: McpPanelProps): React.ReactNode {
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addScope, setAddScope] = useState<McpServerScope>("project");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [adding, setAdding] = useState(false);

  const [testingName, setTestingName] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestMcpServerResult>>({});

  const handleTest = async (server: McpServerInfo): Promise<void> => {
    setTestingName(server.name);
    try {
      const res = await onTestServer({ name: server.name, scope: server.scope });
      setTestResults(prev => ({ ...prev, [server.name]: res }));
      if (res.ok) {
        notifications.show({
          color: "cyan",
          title: `Server "${server.name}" healthy`,
          message: `Connection OK (${res.latencyMs}ms)${res.tools.length > 0 ? ` · ${res.tools.length} tools` : ""}`,
        });
      } else {
        notifications.show({
          color: "red",
          title: `Server "${server.name}" failed`,
          message: res.error || "Connection test failed.",
        });
      }
    } finally {
      setTestingName(null);
    }
  };

  const handleAddSubmit = async (e?: React.SyntheticEvent): Promise<void> => {
    e?.preventDefault();
    const name = addName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const args = addArgs.trim() ? addArgs.trim().split(/\s+/) : undefined;
      await onAddServer({
        name,
        scope: addScope,
        command: addCommand.trim() || undefined,
        args,
        url: addUrl.trim() || undefined,
      });
      notifications.show({
        color: "cyan",
        title: "MCP server added",
        message: `Added "${name}" to ${addScope} config.`,
      });
      setAddName("");
      setAddCommand("");
      setAddArgs("");
      setAddUrl("");
      setShowAdd(false);
      onRefresh?.();
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (server: McpServerInfo): Promise<void> => {
    await onRemoveServer({ name: server.name, scope: server.scope });
    notifications.show({
      color: "plum",
      title: "MCP server removed",
      message: `Removed "${server.name}" from ${server.scope} config.`,
    });
    onRefresh?.();
  };

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="cyan">
              <IconPlugConnected size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              MCP Servers (/mcp)
            </Text>
            <Badge size="xs" variant="light" color={servers.length > 0 ? "cyan" : "gray"}>
              {servers.length} configured
            </Badge>
          </Group>
          <Group gap={6} wrap="nowrap">
            {onRefresh ? (
              <ActionIcon size="sm" variant="subtle" onClick={onRefresh} aria-label="Refresh MCP servers">
                <IconRefresh size={16} />
              </ActionIcon>
            ) : null}
            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close MCP panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="md">
          <Group justify="space-between" align="center">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase">
              Configured Servers
            </Text>
            <Button
              size="xs"
              variant={showAdd ? "subtle" : "light"}
              color="cyan"
              leftSection={<IconPlus size={14} />}
              onClick={() => setShowAdd(prev => !prev)}
            >
              {showAdd ? "Cancel" : "Add Server"}
            </Button>
          </Group>

          <Collapse expanded={showAdd}>
            <Card withBorder radius="md" p="sm" bg="dark.8">
              <form onSubmit={handleAddSubmit}>
                <Stack gap="xs">
                  <Text size="xs" fw={700} c="cyan.4">
                    New MCP Server
                  </Text>
                  <TextInput
                    size="xs"
                    label="Server Identifier"
                    placeholder="e.g. github, filesystem, fetch"
                    value={addName}
                    onChange={e => setAddName(e.currentTarget.value)}
                    required
                  />

                  <Box>
                    <Text size="xs" fw={500} mb={4}>
                      Scope:
                    </Text>
                    <SegmentedControl
                      size="xs"
                      fullWidth
                      value={addScope}
                      onChange={v => setAddScope(v as McpServerScope)}
                      data={[
                        { label: "This Project (.omp/mcp.json)", value: "project" },
                        { label: "Global (~/.omp/mcp.json)", value: "global" },
                      ]}
                    />
                  </Box>

                  <TextInput
                    size="xs"
                    label="Command (stdio)"
                    placeholder="e.g. npx, bunx, uvx, docker"
                    value={addCommand}
                    onChange={e => setAddCommand(e.currentTarget.value)}
                  />

                  <TextInput
                    size="xs"
                    label="Arguments (stdio)"
                    placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path"
                    value={addArgs}
                    onChange={e => setAddArgs(e.currentTarget.value)}
                  />

                  <TextInput
                    size="xs"
                    label="OR Remote Endpoint URL (HTTP/SSE)"
                    placeholder="e.g. https://mcp.example.com/sse"
                    value={addUrl}
                    onChange={e => setAddUrl(e.currentTarget.value)}
                  />

                  <Group justify="flex-end" pt="xs">
                    <Button
                      size="xs"
                      color="cyan"
                      onClick={() => handleAddSubmit()}
                      loading={adding}
                      disabled={!addName.trim() || (!addCommand.trim() && !addUrl.trim())}
                    >
                      Save Configuration
                    </Button>
                  </Group>
                </Stack>
              </form>
            </Card>
          </Collapse>

          {loading ? (
            <Stack align="center" justify="center" py="xl">
              <Loader size="sm" color="cyan" />
            </Stack>
          ) : servers.length === 0 ? (
            <Stack align="center" justify="center" py="xl" gap="xs">
              <IconPlugConnected size={32} color="var(--mantine-color-dimmed)" />
              <Text size="sm" c="dimmed" ta="center">
                No MCP servers configured yet.
              </Text>
              <Text size="xs" c="dimmed" ta="center">
                Add one to expose external tools, resources, and slash commands to the agent.
              </Text>
            </Stack>
          ) : (
            <Stack gap="sm">
              {servers.map(server => {
                const isTesting = testingName === server.name;
                const testResult = testResults[server.name];

                return (
                  <Card key={`${server.scope}-${server.name}`} withBorder radius="md" p="sm" shadow="xs">
                    <Stack gap="xs">
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <Group gap="xs" wrap="nowrap">
                          <Text size="xs" fw={700}>
                            {server.name}
                          </Text>
                          <Badge
                            size="xs"
                            variant="light"
                            color={server.scope === "project" ? "cyan" : "plum"}
                          >
                            {server.scope}
                          </Badge>
                          <Badge size="xs" variant="outline" color={server.disabled ? "gray" : "teal"}>
                            {server.disabled ? "disabled" : "configured"}
                          </Badge>
                        </Group>

                        <Group gap={6} wrap="nowrap">
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="cyan"
                            loading={isTesting}
                            leftSection={<IconRefresh size={12} />}
                            onClick={() => handleTest(server)}
                          >
                            Test
                          </Button>
                          <Tooltip label="Remove from config">
                            <ActionIcon
                              size="xs"
                              variant="subtle"
                              color="red"
                              onClick={() => handleRemove(server)}
                              aria-label={`Remove ${server.name}`}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>

                      {server.command ? (
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" c="dimmed">
                            Command:
                          </Text>
                          <Code style={{ fontSize: "11px" }}>
                            {[server.command, ...(server.args ?? [])].join(" ")}
                          </Code>
                        </Group>
                      ) : null}

                      {server.url ? (
                        <Group gap={4} wrap="nowrap">
                          <Text size="xs" c="dimmed">
                            URL:
                          </Text>
                          <Code style={{ fontSize: "11px" }}>{server.url}</Code>
                        </Group>
                      ) : null}

                      {testResult ? (
                        <Box pt={4} style={{ borderTop: "1px solid var(--omega-line)" }}>
                          <Group justify="space-between" align="center">
                            <Group gap={6}>
                              {testResult.ok ? (
                                <Badge
                                  size="xs"
                                  color="teal"
                                  variant="filled"
                                  leftSection={<IconCheck size={10} />}
                                >
                                  Connected ({testResult.latencyMs}ms)
                                </Badge>
                              ) : (
                                <Badge
                                  size="xs"
                                  color="red"
                                  variant="filled"
                                  leftSection={<IconAlertTriangle size={10} />}
                                >
                                  Failed
                                </Badge>
                              )}
                            </Group>
                            {testResult.error ? (
                              <Text size="xs" c="red.4">
                                {testResult.error}
                              </Text>
                            ) : null}
                          </Group>
                        </Box>
                      ) : null}
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
