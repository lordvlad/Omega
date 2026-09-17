/**
 * Rules panel: inspect, manage, and delete Time-Traveling Stream Rules (TTSR).
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
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
import { IconPlus, IconSearch, IconShield, IconShieldCheck, IconTrash, IconX } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";

import type { DeleteRuleRequest, RuleScopeType, SessionRuleInfo } from "../api/model.ts";
import { Markdown } from "../lib/markdown.tsx";

export interface RulesPanelProps {
  rules: SessionRuleInfo[];
  loading?: boolean;
  onDeleteRule: (req: DeleteRuleRequest) => Promise<void>;
  onCreateRule?: () => void;
  onRefresh?: () => void;
  onClose?: () => void;
}

export function RulesPanel({
  rules,
  loading = false,
  onDeleteRule,
  onCreateRule,
  onRefresh,
  onClose,
}: RulesPanelProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [filterScope, setFilterScope] = useState<string>("all");
  const [deletingName, setDeletingName] = useState<string | null>(null);
  const getConditions = (rule: SessionRuleInfo): string[] => {
    if (Array.isArray(rule.condition)) return rule.condition.map(String);
    if (typeof rule.condition === "string") return [rule.condition];
    return [];
  };

  const getScopes = (rule: SessionRuleInfo): string[] => {
    if (Array.isArray(rule.scope)) return rule.scope.map(String);
    if (typeof rule.scope === "string") return [rule.scope];
    return [];
  };

  const filteredRules = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rules.filter(rule => {
      if (filterScope !== "all" && rule.scopeType !== filterScope) return false;
      if (!q) return true;
      return (
        rule.name.toLowerCase().includes(q) ||
        rule.description.toLowerCase().includes(q) ||
        rule.body.toLowerCase().includes(q) ||
        getConditions(rule).some(c => c.toLowerCase().includes(q))
      );
    });
  }, [rules, query, filterScope]);

  const handleDelete = async (rule: SessionRuleInfo): Promise<void> => {
    setDeletingName(rule.name);
    try {
      await onDeleteRule({ name: rule.name, scopeType: rule.scopeType });
      notifications.show({
        color: "plum",
        title: "Rule deleted",
        message: `Deleted rule "${rule.name}" from ${rule.scopeType} rules.`,
      });
      onRefresh?.();
    } finally {
      setDeletingName(null);
    }
  };

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="orange">
              <IconShieldCheck size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              Stream Rules (/rules)
            </Text>
            <Badge size="xs" variant="light" color="orange">
              {rules.length} active
            </Badge>
          </Group>
          <Group gap={6} wrap="nowrap">
            {onCreateRule ? (
              <Button
                size="xs"
                variant="light"
                color="orange"
                leftSection={<IconPlus size={12} />}
                onClick={onCreateRule}
              >
                Create Rule
              </Button>
            ) : null}
            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close rules panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Box>

      <Box p="sm" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Stack gap="xs">
          <TextInput
            size="xs"
            placeholder="Search rules by name, description, or regex pattern…"
            leftSection={<IconSearch size={14} />}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
          />
          <SegmentedControl
            size="xs"
            fullWidth
            value={filterScope}
            onChange={setFilterScope}
            data={[
              { label: `All (${rules.length})`, value: "all" },
              { label: "This Project (.omp/rules)", value: "project" },
              { label: "Global (~/.omp/agent/rules)", value: "global" },
            ]}
          />
        </Stack>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        {loading ? (
          <Stack align="center" justify="center" py="xl">
            <Loader size="sm" color="orange" />
          </Stack>
        ) : filteredRules.length === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="xs">
            <IconShield size={32} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              {rules.length === 0 ? "No stream rules found." : `No rules match "${query}".`}
            </Text>
            {rules.length === 0 && onCreateRule ? (
              <Button size="xs" variant="subtle" color="orange" onClick={onCreateRule}>
                Create one from an agent mistake (/omfg)
              </Button>
            ) : null}
          </Stack>
        ) : (
          <Stack gap="sm">
            {filteredRules.map(rule => {
              const isDeleting = deletingName === rule.name;

              return (
                <Card key={`${rule.scopeType}-${rule.name}`} withBorder radius="md" p="sm" shadow="xs">
                  <Stack gap="xs">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Group gap={6} wrap="nowrap">
                        <Text size="xs" fw={700} style={{ fontFamily: "monospace" }}>
                          {rule.name}
                        </Text>
                        <Badge
                          size="xs"
                          color={rule.scopeType === "project" ? "cyan" : "plum"}
                          variant="light"
                        >
                          {rule.scopeType}
                        </Badge>
                      </Group>

                      <Tooltip label="Delete rule from disk">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="red"
                          loading={isDeleting}
                          onClick={() => handleDelete(rule)}
                          aria-label={`Delete ${rule.name}`}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>

                    {rule.description ? (
                      <Text size="xs" c="dimmed">
                        {rule.description}
                      </Text>
                    ) : null}

                    {(() => {
                      const conditions = getConditions(rule);
                      const scopes = getScopes(rule);
                      return (
                        <>
                          {conditions.length > 0 ? (
                            <Box>
                              <Text size="xs" fw={600} mb={2}>
                                Condition:
                              </Text>
                              <Group gap={4}>
                                {conditions.map((c, i) => (
                                  <Badge
                                    key={i}
                                    size="xs"
                                    variant="outline"
                                    color="orange"
                                    style={{ fontFamily: "monospace" }}
                                  >
                                    {c}
                                  </Badge>
                                ))}
                              </Group>
                            </Box>
                          ) : null}

                          {scopes.length > 0 ? (
                            <Box>
                              <Text size="xs" fw={600} mb={2}>
                                Scope:
                              </Text>
                              <Group gap={4}>
                                {scopes.map((s, i) => (
                                  <Badge
                                    key={i}
                                    size="xs"
                                    variant="light"
                                    color="cyan"
                                    style={{ fontFamily: "monospace" }}
                                  >
                                    {s}
                                  </Badge>
                                ))}
                              </Group>
                            </Box>
                          ) : null}
                        </>
                      );
                    })()}

                    {rule.body ? (
                      <Box pt={4} style={{ borderTop: "1px solid var(--omega-line)" }}>
                        <Markdown text={rule.body} />
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
