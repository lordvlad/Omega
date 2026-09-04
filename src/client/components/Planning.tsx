/**
 * The planning surface: table of contents on the left, plan document on the
 * right, actions along the bottom.
 *
 * The three regions are one payload from `GET /api/sessions/:key/plan`, so
 * they never disagree about which draft is under review. The actions panel
 * offers exactly the four decisions omp's own plan review offers, with the
 * same role-tier selection and the same keep-context restriction, because a
 * fifth option here would be one omp cannot carry out.
 *
 * On a phone the three regions become one column with a segmented switch: a
 * side-by-side plan document is unreadable at 390px.
 */
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Group,
  Loader,
  NavLink,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Tooltip,
  Typography,
} from "@mantine/core";
import {
  IconCheck,
  IconDeviceFloppy,
  IconEdit,
  IconListSearch,
  IconMessagePlus,
  IconPackage,
  IconTelescope,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import type { PlanAction, PlanDocument } from "../api/model.ts";
import { useRenderedHtml } from "../lib/markdown.tsx";

/** The action buttons, in omp's own order. */
const ACTIONS: Array<{
  action: PlanAction;
  label: string;
  hint: string;
  icon: React.ReactNode;
  color: string;
}> = [
  {
    action: "execute",
    label: "Approve & execute",
    hint: "Execute from a fresh context seeded with this plan.",
    icon: <IconCheck size={16} />,
    color: "cyan",
  },
  {
    action: "compact",
    label: "Approve & compact",
    hint: "Distil the planning transcript, then execute.",
    icon: <IconPackage size={16} />,
    color: "cyan",
  },
  {
    action: "keep",
    label: "Approve & keep context",
    hint: "Execute with the whole planning conversation intact.",
    icon: <IconTelescope size={16} />,
    color: "plum",
  },
  {
    action: "refine",
    label: "Refine",
    hint: "Stay in plan mode and send notes back to the planner.",
    icon: <IconMessagePlus size={16} />,
    color: "plum",
  },
];

export interface PlanningProps {
  plan: PlanDocument | undefined;
  loading: boolean;
  busy: boolean;
  /** True when the layout must collapse to a single column. */
  compact: boolean;
  onAction: (action: PlanAction, feedback: string, tier: string | undefined) => void;
  onSave: (content: string) => void;
}

export function Planning({ plan, loading, busy, compact, onAction, onSave }: PlanningProps) {
  const [feedback, setFeedback] = useState("");
  const [tier, setTier] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pane, setPane] = useState<"toc" | "document" | "actions">("document");
  const [active, setActive] = useState<string | undefined>(undefined);

  const rendered = useRenderedHtml(plan?.html ?? "");

  // omp's slider starts on `default`, so execution does not silently inherit
  // whichever model happened to drive the planning conversation.
  useEffect(() => {
    if (tier !== null || !plan?.tiers.length) return;
    setTier(plan.tiers.some(entry => entry.role === "default") ? "default" : (plan.tiers[0]?.role ?? null));
  }, [plan?.tiers, tier]);

  const tierData = useMemo(
    () => (plan?.tiers ?? []).map(entry => ({ value: entry.role, label: `${entry.role} — ${entry.name}` })),
    [plan?.tiers],
  );

  if (loading && !plan) {
    return (
      <Group justify="center" p="xl">
        <Loader size="sm" />
      </Group>
    );
  }

  if (!plan?.enabled) {
    return (
      <Alert variant="light" color="plum" title="Plan mode is off" m="sm">
        Turn plan mode on to have the agent research first and propose a plan before it edits anything.
      </Alert>
    );
  }

  const scrollTo = (id: string): void => {
    setActive(id);
    // The rendered document carries the same ids the server put in the
    // heading tags, so the TOC scrolls without a second parse.
    window.document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (compact) setPane("document");
  };

  const toc = (
    <Stack gap={2} p="xs">
      <Group gap={6} px="xs" pb={4}>
        <IconListSearch size={14} />
        <Text size="xs" fw={650} tt="uppercase" c="dimmed">
          Contents
        </Text>
      </Group>
      {plan.sections.length === 0 ? (
        <Text size="xs" c="dimmed" px="xs">
          The plan has no headings yet.
        </Text>
      ) : (
        plan.sections.map(section => (
          <NavLink
            key={section.id}
            label={section.title}
            active={section.id === active}
            onClick={() => scrollTo(section.id)}
            // Depth is expressed as indentation so the outline is readable
            // without rendering a nested tree.
            pl={8 + (section.level - 1) * 12}
            py={4}
            color="cyan"
            variant="light"
          />
        ))
      )}
    </Stack>
  );

  const documentPane = (
    <Stack gap={0} h="100%">
      <Group justify="space-between" p="xs" wrap="nowrap">
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" fw={650} truncate>
            {plan.title ?? "Draft plan"}
          </Text>
          {plan.awaitingApproval ? (
            <Badge size="sm" color="cyan" variant="filled">
              awaiting review
            </Badge>
          ) : (
            <Badge size="sm" color="plum" variant="light">
              drafting
            </Badge>
          )}
        </Group>
        <Tooltip label={editing ? "Save the plan" : "Edit the plan"}>
          <ActionIcon
            onClick={() => {
              if (editing) {
                onSave(draft);
                setEditing(false);
              } else {
                setDraft(plan.content);
                setEditing(true);
              }
            }}
            disabled={!plan.content}
            aria-label={editing ? "Save the plan" : "Edit the plan"}
            color={editing ? "cyan" : "plum"}
          >
            {editing ? <IconDeviceFloppy size={18} /> : <IconEdit size={18} />}
          </ActionIcon>
        </Tooltip>
      </Group>

      <ScrollArea style={{ flex: 1 }} type="auto" offsetScrollbars className="omega-plan-scroll">
        {plan.content ? (
          editing ? (
            <Textarea
              autosize
              minRows={20}
              value={draft}
              onChange={event => setDraft(event.currentTarget.value)}
              styles={{ input: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 13 } }}
              p="xs"
            />
          ) : (
            <Typography className="omega-markdown" p="sm">
              {rendered}
            </Typography>
          )
        ) : (
          <Text size="sm" c="dimmed" p="sm">
            The agent has not written a plan yet. It will appear here as soon as it does.
          </Text>
        )}
      </ScrollArea>
    </Stack>
  );

  const actions = (
    <Stack gap={8} p="sm">
      {!plan.awaitingApproval ? (
        <Text size="xs" c="dimmed">
          The planner has not submitted this plan for review yet. You can still edit it, or send notes with
          Refine.
        </Text>
      ) : null}

      <Textarea
        label="Notes for the planner"
        description="Sent with Refine; ignored by the approve actions."
        placeholder="What should change about this plan?"
        autosize
        minRows={2}
        maxRows={6}
        value={feedback}
        onChange={event => setFeedback(event.currentTarget.value)}
      />

      {tierData.length > 1 ? (
        <Select
          size="xs"
          label="Continue with"
          description="Role model that executes the approved plan."
          data={tierData}
          value={tier}
          onChange={setTier}
          comboboxProps={{ withinPortal: true }}
        />
      ) : null}

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
        {ACTIONS.map(entry => {
          // omp disables keep-context when the planning transcript would
          // leave no room to execute; mirror that rather than letting the
          // request fail server-side.
          const blocked = entry.action === "keep" && plan.keepContextDisabled;
          const needsFeedback = entry.action === "refine" && !feedback.trim();
          return (
            <Tooltip
              key={entry.action}
              label={blocked ? "Not enough context left to keep the planning history." : entry.hint}
              multiline
              w={240}
            >
              <Button
                variant={entry.action === "refine" ? "default" : "filled"}
                color={entry.color}
                leftSection={entry.icon}
                loading={busy}
                disabled={blocked || needsFeedback}
                onClick={() => {
                  onAction(entry.action, feedback, tier ?? undefined);
                  if (entry.action === "refine") setFeedback("");
                }}
                fullWidth
              >
                {entry.label}
              </Button>
            </Tooltip>
          );
        })}
      </SimpleGrid>
    </Stack>
  );

  if (compact) {
    return (
      <Stack gap={0} h="100%">
        <SegmentedControl
          value={pane}
          onChange={value => setPane(value as typeof pane)}
          data={[
            { value: "toc", label: "Contents" },
            { value: "document", label: "Plan" },
            { value: "actions", label: "Actions" },
          ]}
          m="xs"
        />
        <Box style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {pane === "toc" ? toc : pane === "document" ? documentPane : actions}
        </Box>
      </Stack>
    );
  }

  return (
    <Group gap={0} align="stretch" h="100%" wrap="nowrap">
      <Paper className="omega-plan-toc" withBorder radius={0}>
        <ScrollArea h="100%" type="auto">
          {toc}
        </ScrollArea>
      </Paper>
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Box style={{ flex: 1, minHeight: 0 }}>{documentPane}</Box>
        <Paper className="omega-plan-actions" withBorder radius={0}>
          {actions}
        </Paper>
      </Stack>
    </Group>
  );
}
