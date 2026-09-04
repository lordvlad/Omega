/**
 * The composer: message entry, model selection, dictation, and the stop
 * control.
 *
 * While a turn is streaming, sending is not blocked — omp accepts a message
 * mid-turn as either a steer or a follow-up, and both are useful, so the
 * delivery choice is exposed rather than decided for the user.
 */
import {
  ActionIcon,
  Box,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { IconMicrophone, IconMicrophoneOff, IconPlayerStopFilled, IconSend } from "@tabler/icons-react";
import { memo, useCallback, useMemo, useState } from "react";

import type { LiveState, ModelOption } from "../api/model.ts";
import { useDictation } from "../lib/speech.ts";

export interface ComposerProps {
  state: LiveState | undefined;
  models: ModelOption[];
  modelsLoading: boolean;
  running: boolean;
  onSend: (message: string, deliverAs: "steer" | "followUp" | undefined) => void;
  onAbort: () => void;
  onSelectModel: (ref: string) => void;
}

export function Composer({
  state,
  models,
  modelsLoading,
  running,
  onSend,
  onAbort,
  onSelectModel,
}: ComposerProps) {
  const [text, setText] = useState("");
  const [deliverAs, setDeliverAs] = useState<"steer" | "followUp">("steer");

  // Stable dictation commit callback avoids re-binding speech recognition listeners.
  const onDictationCommit = useCallback((phrase: string) => {
    if (!phrase) return;
    setText(current => (current ? `${current} ${phrase}` : phrase));
  }, []);
  const dictation = useDictation(onDictationCommit);

  const send = (): void => {
    const message = text.trim();
    if (!message || !state) return;
    onSend(message, running ? deliverAs : undefined);
    setText("");
    if (dictation.listening) dictation.stop();
  };

  const disabled = state === undefined;

  return (
    <Paper className="omega-composer" p="sm" radius={0} withBorder>
      <Stack gap={8}>
        <Group gap={8} wrap="nowrap" align="flex-end">
          <Textarea
            flex={1}
            autosize
            minRows={1}
            maxRows={8}
            disabled={disabled}
            placeholder={disabled ? "Open a session to start" : "Message the agent…"}
            value={dictation.interim ? `${text} ${dictation.interim}`.trim() : text}
            onChange={event => setText(event.currentTarget.value)}
            onKeyDown={event => {
              // Enter sends on a physical keyboard; Shift+Enter makes a
              // newline. On a phone the on-screen keyboard's return key
              // inserts a newline, so the send button is the real control.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
          />

          {dictation.supported ? (
            <Tooltip label={dictation.listening ? "Stop dictation" : "Dictate"}>
              <ActionIcon
                variant={dictation.listening ? "filled" : "subtle"}
                color={dictation.listening ? "cyan" : "plum"}
                disabled={disabled}
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
                aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
                className={dictation.listening ? "omega-pulse" : undefined}
              >
                {dictation.listening ? <IconMicrophoneOff size={18} /> : <IconMicrophone size={18} />}
              </ActionIcon>
            </Tooltip>
          ) : null}

          {running ? (
            <Tooltip label="Stop the turn">
              <ActionIcon variant="filled" color="red" onClick={onAbort} aria-label="Stop the turn">
                <IconPlayerStopFilled size={18} />
              </ActionIcon>
            </Tooltip>
          ) : (
            <Tooltip label="Send">
              <ActionIcon
                variant="filled"
                color="plum"
                disabled={disabled || !text.trim()}
                onClick={send}
                aria-label="Send message"
              >
                <IconSend size={18} />
              </ActionIcon>
            </Tooltip>
          )}
        </Group>

        <Group gap={8} wrap="wrap" justify="space-between">
          <ModelSelector
            model={state?.model ?? null}
            models={models}
            modelsLoading={modelsLoading}
            disabled={disabled}
            onSelectModel={onSelectModel}
          />

          {running ? (
            <SegmentedControl
              size="xs"
              value={deliverAs}
              onChange={value => setDeliverAs(value as "steer" | "followUp")}
              data={[
                { value: "steer", label: "Steer" },
                { value: "followUp", label: "Queue" },
              ]}
            />
          ) : null}

          {state?.contextUsage ? (
            <Text size="xs" c="dimmed">
              {Math.round(state.contextUsage.percent)}% context
              {state.queued > 0 ? ` · ${state.queued} queued` : ""}
            </Text>
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

interface ModelSelectorProps {
  model: string | null;
  models: ModelOption[];
  modelsLoading: boolean;
  disabled: boolean;
  onSelectModel: (ref: string) => void;
}

/**
 * Isolated and memoized so typing in the composer textarea does NOT re-render
 * the 593-item model dropdown on every keystroke.
 */
const ModelSelector = memo(function ModelSelector({
  model,
  models,
  modelsLoading,
  disabled,
  onSelectModel,
}: ModelSelectorProps) {
  // Group by provider and memoize on models catalog changes.
  const modelData = useMemo(() => {
    const byProvider = new Map<string, Array<{ value: string; label: string }>>();
    for (const m of models) {
      const group = byProvider.get(m.provider);
      const item = { value: m.ref, label: m.name };
      if (group) group.push(item);
      else byProvider.set(m.provider, [item]);
    }
    return [...byProvider.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([provider, items]) => ({ group: provider, items }));
  }, [models]);

  return (
    <Select
      size="xs"
      searchable
      limit={30}
      disabled={disabled}
      data={modelData}
      value={model}
      onChange={value => value && onSelectModel(value)}
      placeholder={modelsLoading ? "Loading models…" : "Select a model"}
      leftSection={modelsLoading ? <Loader size={12} /> : undefined}
      nothingFoundMessage="No matching model"
      maxDropdownHeight={280}
      comboboxProps={{ withinPortal: true }}
      style={{ flex: "1 1 200px", minWidth: 160 }}
      aria-label="Model"
    />
  );
});
