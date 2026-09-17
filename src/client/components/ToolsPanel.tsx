/**
 * Tools panel: inspect available tools across built-in, custom, MCP, and xdev sources,
 * with parameter schemas and forced tool choice controls.
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
import {
  IconBolt,
  IconChevronDown,
  IconChevronRight,
  IconClearAll,
  IconSearch,
  IconTools,
  IconX,
} from "@tabler/icons-react";
import React, { useMemo, useState } from "react";

import type { SessionToolInfo, ToolSource } from "../api/model.ts";

export interface ToolsPanelProps {
  tools: SessionToolInfo[];
  forcedTool?: string;
  loading?: boolean;
  onForceTool: (toolName: string) => void;
  onClearForce: () => void;
  onClose?: () => void;
}

function sourceColor(source: ToolSource): string {
  switch (source) {
    case "builtin":
      return "teal";
    case "custom":
      return "cyan";
    case "mcp":
      return "plum";
    case "xdev":
      return "yellow";
    default:
      return "gray";
  }
}

export function ToolsPanel({
  tools,
  forcedTool,
  loading = false,
  onForceTool,
  onClearForce,
  onClose,
}: ToolsPanelProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [filterSource, setFilterSource] = useState<string>("all");
  const [expandedParams, setExpandedParams] = useState<Record<string, boolean>>({});

  const toggleParams = (name: string): void => {
    setExpandedParams(prev => ({ ...prev, [name]: !prev[name] }));
  };

  const activeCount = tools.filter(t => t.active).length;

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tools.filter(tool => {
      if (filterSource !== "all" && tool.source !== filterSource) return false;
      if (!q) return true;
      return (
        tool.name.toLowerCase().includes(q) ||
        tool.description.toLowerCase().includes(q) ||
        tool.source.toLowerCase().includes(q)
      );
    });
  }, [tools, query, filterSource]);

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="teal">
              <IconTools size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              Tools (/tools)
            </Text>
            <Badge size="xs" variant="light" color="teal">
              {activeCount} active / {tools.length} total
            </Badge>
          </Group>
          {onClose ? (
            <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close tools panel">
              <IconX size={16} />
            </ActionIcon>
          ) : null}
        </Group>
      </Box>

      {forcedTool ? (
        <Box px="md" py="xs" bg="cyan.9" style={{ borderBottom: "1px solid var(--omega-line)" }}>
          <Group justify="space-between" align="center" wrap="nowrap">
            <Group gap={6} wrap="nowrap">
              <IconBolt size={14} color="var(--mantine-color-cyan-2)" />
              <Text size="xs" fw={600} c="cyan.1">
                Forced tool for next turn: <Code>{forcedTool}</Code>
              </Text>
            </Group>
            <Button
              size="compact-xs"
              variant="subtle"
              color="gray"
              leftSection={<IconClearAll size={12} />}
              onClick={onClearForce}
            >
              Clear
            </Button>
          </Group>
        </Box>
      ) : null}

      <Box p="sm" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Stack gap="xs">
          <TextInput
            size="xs"
            placeholder="Search tools by name, description, or source…"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
          />
          <SegmentedControl
            size="xs"
            fullWidth
            value={filterSource}
            onChange={setFilterSource}
            data={[
              { label: `All (${tools.length})`, value: "all" },
              { label: "Built-in", value: "builtin" },
              { label: "Custom (A2UI)", value: "custom" },
              { label: "MCP", value: "mcp" },
              { label: "xdev", value: "xdev" },
            ]}
          />
        </Stack>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        {loading ? (
          <Stack align="center" justify="center" py="xl">
            <Loader size="sm" color="teal" />
          </Stack>
        ) : filteredTools.length === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="xs">
            <Text size="sm" c="dimmed" ta="center">
              No tools match "{query}".
            </Text>
          </Stack>
        ) : (
          <Stack gap="sm">
            {filteredTools.map(tool => {
              const isForced = forcedTool === tool.name;
              const hasParams = Boolean(tool.parameters && Object.keys(tool.parameters).length > 0);
              const isExpanded = expandedParams[tool.name] === true;

              return (
                <Card key={tool.name} withBorder radius="md" p="sm" shadow="xs">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" fw={700} style={{ fontFamily: "monospace" }}>
                          {tool.name}
                        </Text>
                        <Badge size="xs" color={sourceColor(tool.source)} variant="light">
                          {tool.source}
                        </Badge>
                        <Badge size="xs" color={tool.active ? "teal" : "gray"} variant="outline">
                          {tool.active ? "active" : "discoverable"}
                        </Badge>
                        {isForced ? (
                          <Badge size="xs" color="cyan" variant="filled" leftSection={<IconBolt size={10} />}>
                            forced
                          </Badge>
                        ) : null}
                      </Group>

                      <Group gap={6} wrap="nowrap">
                        {isForced ? (
                          <Button size="compact-xs" variant="subtle" color="gray" onClick={onClearForce}>
                            Unforce
                          </Button>
                        ) : (
                          <Tooltip label="Force agent to use this tool on next turn (/force)">
                            <Button
                              size="compact-xs"
                              variant="light"
                              color="cyan"
                              leftSection={<IconBolt size={12} />}
                              onClick={() => onForceTool(tool.name)}
                            >
                              Force
                            </Button>
                          </Tooltip>
                        )}
                      </Group>
                    </Group>

                    <Text size="xs" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                      {tool.description}
                    </Text>

                    {hasParams ? (
                      <Box>
                        <Group gap={4} style={{ cursor: "pointer" }} onClick={() => toggleParams(tool.name)}>
                          {isExpanded ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}
                          <Text size="xs" fw={600} c="dimmed">
                            Parameter Schema
                          </Text>
                        </Group>
                        <Collapse expanded={isExpanded}>
                          <Box pt={4}>
                            <Code block style={{ fontSize: "11px", maxHeight: "180px", overflow: "auto" }}>
                              {JSON.stringify(tool.parameters, null, 2)}
                            </Code>
                          </Box>
                        </Collapse>
                      </Box>
                    ) : null}
                  </Stack>
                </Card>
              );
            })}
          </Stack>
        )}
      </ScrollArea>
    </Stack>
  );
}
