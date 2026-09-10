/**
 * The composer: message entry, prompt mode, dictation, and the stop control.
 *
 * One control decides what the next message does. Plan mode is a property of
 * the session rather than of a single message, but from the keyboard it is the
 * same decision — "research and propose" instead of "go and do" — so it sits
 * with the delivery choices rather than in the status bar.
 *
 * While a turn is streaming, sending is not blocked: omp accepts a message
 * mid-turn as either a steer or a follow-up, and both are useful, so the
 * delivery choice is exposed rather than decided for the user.
 */
import {
  ActionIcon,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconCpu,
  IconMicrophone,
  IconMicrophoneOff,
  IconPlayerStopFilled,
  IconSend,
  IconStack2,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";

import type { LiveState } from "../api/model.ts";
import { useDictation } from "../lib/speech.ts";

/** How the next message is delivered, and what the agent is allowed to do with it. */
type PromptMode = "send" | "plan" | "steer" | "followUp";

export interface ComposerProps {
  state: LiveState | undefined;
  running: boolean;
  /** Text to load into the input, e.g. the message a branch was taken from. */
  draft?: { text: string };
  /** Plan mode, straight from the session; the mode control reflects it. */
  planEnabled: boolean;
  /** True while the plan-mode round trip is in flight. */
  planPending?: boolean;
  onSend: (message: string, deliverAs: "steer" | "followUp" | undefined) => void;
  onPlanMode: (enabled: boolean) => void;
  /** Open the model picker; the model is named here rather than in the header. */
  onChangeModel: () => void;
  onAbort: () => void;
  /** Messages waiting to be delivered; polled, so fresher than `state.queued`. */
  queued: number;
  /** Open the queue panel; only reachable while something is queued. */
  onOpenQueue: () => void;
  /** True on a phone viewport: dictation is hidden, the OS keyboard has its own. */
  compact?: boolean;
  /**
   * True when the device has no network. Sending is blocked rather than
   * attempted: `send` clears the input, so a doomed request would take the
   * message with it.
   */
  offline?: boolean;
}

export function Composer({
  state,
  running,
  draft,
  planEnabled,
  planPending = false,
  onSend,
  onChangeModel,
  onPlanMode,
  onAbort,
  queued,
  onOpenQueue,
  compact = false,
  offline = false,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [deliverAs, setDeliverAs] = useState<"steer" | "followUp">("steer");

  // A branch hands back the message it branched from; loading it into the
  // input is the point of branching. Keyed on object identity so the same
  // text can be re-loaded by a later branch.
  useEffect(() => {
    if (draft) setText(draft.text);
  }, [draft]);

  // Stable dictation commit callback avoids re-binding speech recognition listeners.
  const onDictationCommit = useCallback((phrase: string) => {
    if (!phrase) return;
    setText(current => (current ? `${current} ${phrase}` : phrase));
  }, []);
  const dictation = useDictation(onDictationCommit);

  const send = (): void => {
    const message = text.trim();
    if (!message || !state) return;
    // Clearing the input is what makes this unsafe offline: the request would
    // fail and take the message with it. Ctrl+Enter lands here too.
    if (offline) return;
    onSend(message, running ? deliverAs : undefined);
    setText("");
    if (dictation.listening) dictation.stop();
  };

  const disabled = state === undefined;

  /**
   * The mode shown is the session's, not a local guess: plan mode wins because
   * it changes what the agent may do, and the delivery choice only matters
   * once a turn is already streaming.
   */
  const mode: PromptMode = planEnabled ? "plan" : running ? deliverAs : "send";

  const chooseMode = (next: PromptMode): void => {
    if (next === "plan") {
      if (!planEnabled) onPlanMode(true);
      return;
    }
    // Every other mode is the agent acting, so leaving plan mode is implied.
    if (planEnabled) onPlanMode(false);
    if (next === "steer" || next === "followUp") setDeliverAs(next);
  };

  // Steer and queue only mean something against a turn in flight.
  const modes = running
    ? [
        { value: "steer", label: "Steer" },
        { value: "followUp", label: "Queue" },
        { value: "plan", label: "Plan" },
      ]
    : [
        { value: "send", label: "Send" },
        { value: "plan", label: "Plan" },
      ];

  const MODE_HINT: Record<PromptMode, string> = {
    send: "A normal turn: the agent answers and may edit code.",
    plan: "The agent researches and drafts a plan before modifying anything.",
    steer: "Interrupt the turn in flight and redirect it with this message.",
    followUp: "Deliver this message after the current turn finishes.",
  };

  return (
    <Paper className="omega-composer" p="sm" radius={0} withBorder>
      <Stack gap={8} className="omega-measure">
        <Group gap={8} wrap="nowrap" align="flex-end">
          <Textarea
            flex={1}
            autosize
            minRows={3}
            maxRows={10}
            disabled={disabled}
            placeholder={disabled ? "Open a session to start" : "Message the agent…"}
            value={dictation.interim ? `${text} ${dictation.interim}`.trim() : text}
            onChange={event => setText(event.currentTarget.value)}
            onKeyDown={event => {
              // Enter is a newline, always. Prose for an agent runs to
              // paragraphs and pasted snippets, and a stray Enter sending
              // half a thought costs a turn; Ctrl/⌘+Enter sends.
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              if (!event.ctrlKey && !event.metaKey) return;
              event.preventDefault();
              send();
            }}
          />

          <Stack gap={6} align="center" style={{ flexShrink: 0 }}>
            {dictation.supported && !compact ? (
              <Tooltip label={dictation.listening ? "Stop dictation" : "Dictate"} position="left">
                <ActionIcon
                  size="xl"
                  radius="md"
                  variant={dictation.listening ? "filled" : "subtle"}
                  color={dictation.listening ? "cyan" : "plum"}
                  disabled={disabled}
                  onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                  aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
                  className={dictation.listening ? "omega-pulse" : undefined}
                >
                  {dictation.listening ? <IconMicrophoneOff size={22} /> : <IconMicrophone size={22} />}
                </ActionIcon>
              </Tooltip>
            ) : null}

            {/*
             * Stop takes send's slot while a turn is in flight, so the primary
             * control is the useful one. Typing during a turn is a steer or a
             * queued follow-up though — both real actions — so send returns
             * beside stop as soon as the input has content, rather than
             * leaving Ctrl+Enter as the only way to deliver it.
             */}
            {!running || text.trim() ? (
              <Tooltip
                label={
                  offline
                    ? "No network. Your message stays in the box until the connection is back."
                    : `${MODE_HINT[mode]} Ctrl+Enter sends.`
                }
                position="left"
                multiline
                w={240}
              >
                <ActionIcon
                  size="xl"
                  radius="md"
                  variant="filled"
                  color={mode === "plan" ? "cyan" : "plum"}
                  disabled={disabled || !text.trim() || offline}
                  onClick={send}
                  aria-label="Send message"
                >
                  <IconSend size={22} />
                </ActionIcon>
              </Tooltip>
            ) : null}

            {running ? (
              <Tooltip label="Interrupt the assistant" position="left">
                <ActionIcon
                  size="xl"
                  radius="md"
                  variant="filled"
                  color="red"
                  onClick={onAbort}
                  aria-label="Interrupt the assistant"
                >
                  <IconPlayerStopFilled size={22} />
                </ActionIcon>
              </Tooltip>
            ) : null}
          </Stack>
        </Group>

        <Group gap={8} wrap="wrap" justify="space-between">
          <Group gap={8} wrap="nowrap">
            <Tooltip label={MODE_HINT[mode]} multiline w={240} position="top-start">
              <SegmentedControl
                size="xs"
                value={mode}
                onChange={value => chooseMode(value as PromptMode)}
                disabled={disabled || planPending}
                data={modes}
                aria-label="Prompt mode"
              />
            </Tooltip>
            {queued > 0 ? (
              <Tooltip label="Edit or drop the messages waiting to be delivered" position="top">
                <UnstyledButton
                  onClick={onOpenQueue}
                  aria-label="Open the message queue"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                >
                  <IconStack2 size={13} />
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}
                  >
                    {queued} queued
                  </Text>
                </UnstyledButton>
              </Tooltip>
            ) : null}
          </Group>

          {state ? (
            <Tooltip label="Change model (/switch)" position="top-end">
              <UnstyledButton
                onClick={onChangeModel}
                aria-label="Change model"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
              >
                <IconCpu size={13} />
                <Text
                  size="xs"
                  c="dimmed"
                  truncate
                  style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}
                >
                  {state.modelName}
                </Text>
              </UnstyledButton>
            </Tooltip>
          ) : null}
        </Group>

        {dictation.error ? (
          <Text size="xs" c="red.4">
            {dictation.error}
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}
