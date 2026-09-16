/**
 * OMFG panel: review and save stream rules (TTSR) generated from agent mistakes.
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
  Textarea,
  ThemeIcon,
} from "@mantine/core";
import { IconAlertTriangle, IconCheck, IconEdit, IconShield, IconX } from "@tabler/icons-react";
import React, { useState } from "react";

import type { OmfgRuleCandidate } from "../api/model.ts";

export interface OmfgPanelProps {
  complaint: string;
  candidate?: OmfgRuleCandidate;
  loading?: boolean;
  saving?: boolean;
  error?: string;
  onSave: (name: string, fileContent: string, scope: "project" | "global") => void;
  onAmend: (feedback: string) => void;
  onClose?: () => void;
}

export function OmfgPanel({
  complaint,
  candidate,
  loading = false,
  saving = false,
  error,
  onSave,
  onAmend,
  onClose,
}: OmfgPanelProps): React.ReactNode {
  const [scope, setScope] = useState<"project" | "global">("project");
  const [name, setName] = useState(candidate?.name ?? "");
  const [body, setBody] = useState(candidate?.body ?? "");
  const [amending, setAmending] = useState(false);
  const [amendFeedback, setAmendFeedback] = useState("");

  // Keep local state in sync when candidate updates
  React.useEffect(() => {
    if (candidate) {
      setName(candidate.name);
      setBody(candidate.body);
    }
  }, [candidate]);

  const handleSave = (): void => {
    if (!candidate) return;

    const conditions: string[] = Array.isArray(candidate.condition)
      ? candidate.condition.map(String)
      : typeof candidate.condition === "string"
        ? [candidate.condition]
        : [];
    const scopes: string[] = Array.isArray(candidate.scope)
      ? candidate.scope.map(String)
      : typeof candidate.scope === "string"
        ? [candidate.scope]
        : [];

    const conditionLines =
      conditions.length === 1
        ? `condition: ${JSON.stringify(conditions[0])}`
        : `condition:\n${conditions.map(c => `  - ${JSON.stringify(c)}`).join("\n")}`;
    const scopeLines =
      scopes.length > 0
        ? scopes.length === 1
          ? `scope: ${JSON.stringify(scopes[0])}`
          : `scope:\n${scopes.map(s => `  - ${JSON.stringify(s)}`).join("\n")}`
        : "";

    const fileContent = [
      "---",
      `description: ${JSON.stringify(candidate.description)}`,
      conditionLines,
      scopeLines,
      "---",
      "",
      body.trim(),
      "",
    ]
      .filter(Boolean)
      .join("\n");

    onSave(name.trim() || candidate.name, fileContent, scope);
  };

  const handleAmendSubmit = (): void => {
    if (!amendFeedback.trim()) return;
    onAmend(amendFeedback.trim());
    setAmending(false);
    setAmendFeedback("");
  };

  const conditionsList: string[] = candidate
    ? Array.isArray(candidate.condition)
      ? candidate.condition.map(String)
      : typeof candidate.condition === "string"
        ? [candidate.condition]
        : []
    : [];

  const scopesList: string[] = candidate
    ? Array.isArray(candidate.scope)
      ? candidate.scope.map(String)
      : typeof candidate.scope === "string"
        ? [candidate.scope]
        : []
    : [];

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="orange">
              <IconShield size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              Create Rule from Mistake (/omfg)
            </Text>
          </Group>
          {onClose ? (
            <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close OMFG panel">
              <IconX size={16} />
            </ActionIcon>
          ) : null}
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        <Stack gap="md">
          <Card withBorder radius="md" p="sm" bg="dark.7">
            <Stack gap={4}>
              <Text size="xs" fw={700} c="dimmed">
                Reported Mistake:
              </Text>
              <Text size="xs" c="orange.3">
                {complaint}
              </Text>
            </Stack>
          </Card>

          {loading ? (
            <Stack align="center" justify="center" py="xl" gap="sm">
              <Loader size="sm" color="orange" />
              <Text size="sm" c="dimmed" className="omega-pulse" ta="center">
                Analyzing previous turn and synthesizing stream rule…
              </Text>
            </Stack>
          ) : error ? (
            <Card withBorder radius="md" p="sm" bg="red.9">
              <Group gap="xs">
                <IconAlertTriangle size={16} color="var(--mantine-color-red-4)" />
                <Text size="xs" c="red.1">
                  {error}
                </Text>
              </Group>
            </Card>
          ) : candidate ? (
            <Stack gap="md">
              <TextInput
                label="Rule Identifier"
                description="Unique kebab-case name for this rule"
                size="xs"
                value={name}
                onChange={e => setName(e.currentTarget.value)}
              />

              <TextInput label="Summary" size="xs" readOnly value={candidate.description} />

              <Box>
                <Text size="xs" fw={600} mb={4}>
                  Trigger Conditions (Regex):
                </Text>
                <Group gap={6}>
                  {conditionsList.map((c, i) => (
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

              {scopesList.length > 0 ? (
                <Box>
                  <Text size="xs" fw={600} mb={4}>
                    Scoped Stream Channels:
                  </Text>
                  <Group gap={6}>
                    {scopesList.map((s, i) => (
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

              <Textarea
                label="Correction Guidance (Markdown)"
                description="Injected into the model's stream when the condition triggers"
                size="xs"
                minRows={3}
                value={body}
                onChange={e => setBody(e.currentTarget.value)}
              />

              <Box>
                <Text size="xs" fw={600} mb={4}>
                  Save Location:
                </Text>
                <SegmentedControl
                  size="xs"
                  fullWidth
                  value={scope}
                  onChange={v => setScope(v as "project" | "global")}
                  data={[
                    { label: "This Project (.omp/rules)", value: "project" },
                    { label: "Global (~/.omp/agent/rules)", value: "global" },
                  ]}
                />
              </Box>

              {amending ? (
                <Card withBorder radius="md" p="sm" bg="dark.8">
                  <Stack gap="xs">
                    <TextInput
                      size="xs"
                      placeholder="e.g. Scope to *.tsx files only or change condition…"
                      value={amendFeedback}
                      onChange={e => setAmendFeedback(e.currentTarget.value)}
                      label="Amendment Feedback"
                    />
                    <Group justify="flex-end" gap="xs">
                      <Button size="xs" variant="subtle" onClick={() => setAmending(false)}>
                        Cancel
                      </Button>
                      <Button
                        size="xs"
                        color="orange"
                        onClick={handleAmendSubmit}
                        disabled={!amendFeedback.trim()}
                      >
                        Re-generate
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ) : (
                <Group justify="space-between" pt="sm">
                  <Button
                    size="xs"
                    variant="light"
                    color="orange"
                    leftSection={<IconEdit size={14} />}
                    onClick={() => setAmending(true)}
                  >
                    Amend with feedback…
                  </Button>
                  <Button
                    size="xs"
                    color="orange"
                    variant="filled"
                    loading={saving}
                    leftSection={<IconCheck size={14} />}
                    onClick={handleSave}
                  >
                    Save Rule
                  </Button>
                </Group>
              )}
            </Stack>
          ) : null}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}
