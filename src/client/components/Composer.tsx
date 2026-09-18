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
  Badge,
  Group,
  Paper,
  Pill,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useMergedRef, useResizeObserver } from "@mantine/hooks";
import {
  IconArrowUp,
  IconBolt,
  IconBrain,
  IconClockPause,
  IconHighlight,
  IconMicrophone,
  IconMicrophoneOff,
  IconPaperclip,
  IconPlayerStopFilled,
  IconStack2,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Attachment, LiveState } from "../api/model.ts";
import { useQueuedSends } from "../lib/outbox.ts";
import { useDictation } from "../lib/speech.ts";

/** How the next message is delivered, and what the agent is allowed to do with it. */
type PromptMode = "send" | "plan" | "steer" | "followUp";

/**
 * Largest single file that will be sent.
 *
 * The whole attachment travels as base64 inside the JSON prompt body, so this
 * is a ceiling on request size as much as on file size. Well above a phone
 * screenshot and well below anything that would stall a LAN request.
 */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;

/** A picked file, held until the message it belongs to is sent. */
interface Attached {
  /** Name, size and mtime: enough to notice the same file picked twice. */
  id: string;
  file: File;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Read one file as base64, without the `data:` prefix the server does not want. */
function encode(file: File): Promise<Attachment> {
  const { promise, resolve, reject } = Promise.withResolvers<Attachment>();
  const reader = new FileReader();
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  reader.onload = () => {
    const result = String(reader.result);
    const comma = result.indexOf(",");
    resolve({
      name: file.name,
      // Browsers leave this empty for extensions they do not know; the
      // server falls back to the filename, so send it as-is.
      mimeType: file.type,
      data: comma >= 0 ? result.slice(comma + 1) : result,
    });
  };
  reader.readAsDataURL(file);
  return promise;
}

export interface ComposerProps {
  state: LiveState | undefined;
  running: boolean;
  /** Text to load into the input, e.g. the message a branch was taken from. */
  draft?: { text: string };
  /** Plan mode, straight from the session; the mode control reflects it. */
  planEnabled: boolean;
  /** True while the plan-mode round trip is in flight. */
  planPending?: boolean;
  onSend: (
    message: string,
    deliverAs: "steer" | "followUp" | undefined,
    attachments: Attachment[] | undefined,
  ) => void;
  onPlanMode: (enabled: boolean) => void;
  /** Open the model picker; the model is named here rather than in the header. */
  onChangeModel: () => void;
  /** Open the thinking level picker (/think). */
  onChangeThinking?: () => void;
  onAbort: () => void;
  /** Messages waiting to be delivered; polled, so fresher than `state.queued`. */
  queued: number;
  /** Open the queue panel; only reachable while something is queued. */
  onOpenQueue: () => void;
  /** Annotations captured but not sent; they ride along with the next message. */
  annotations?: number;
  /** Open the annotations panel; only reachable while something is annotated. */
  onOpenAnnotations?: () => void;
  /**
   * The user opened a command: `/` typed into an empty input.
   *
   * Only the first character counts. A slash anywhere else is a path, a
   * fraction, or a closing tag, and hijacking those would make the input
   * unusable for ordinary prose.
   */
  onSlash?: () => void;
  /**
   * The user typed `@` to mention a file (either as first character or after a space).
   */
  onAt?: () => void;
  /** File selected from the palette to insert into the message. */
  insertedFile?: { path: string; id: number };
  /** True on a phone viewport: dictation is hidden, the OS keyboard has its own. */
  compact?: boolean;
  /**
   * True when the device has no network. Sending is blocked rather than
   * attempted: `send` clears the input, so a doomed request would take the
   * message with it.
   */
  offline?: boolean;
  /** Active forced tool choice for the next turn. */
  forcedTool?: string;
  onClearForcedTool?: () => void;
  /** Submit message on Enter (Shift+Enter inserts newline, Ctrl/Cmd+Enter always submits). */
  enterSubmits?: boolean;
}

export function Composer({
  state,
  running,
  draft,
  planEnabled,
  planPending = false,
  onSend,
  onChangeModel,
  onChangeThinking,
  onPlanMode,
  onAbort,
  queued,
  onOpenQueue,
  annotations = 0,
  onOpenAnnotations,
  onSlash,
  onAt,
  insertedFile,
  compact = false,
  offline = false,
  enterSubmits = false,
  forcedTool,
  onClearForcedTool,
}: ComposerProps) {
  const outbox = useQueuedSends();
  const [text, setText] = useState("");
  const [deliverAs, setDeliverAs] = useState<"steer" | "followUp">("steer");
  const [files, setFiles] = useState<Attached[]>([]);
  const [readError, setReadError] = useState<string | undefined>(undefined);
  const picker = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Grown past its one-row baseline: the side buttons switch from a row
  // beside the input to a column that spans it, so a tall message still has
  // one of them within reach at the top and one at the bottom instead of
  // both stranded in the middle.
  //
  // Layout lock: switching between horizontal Group and vertical Stack changes
  // the available textarea width by ~40px, which would otherwise cause text
  // at boundary lengths to oscillate rapidly between wrapping and not wrapping.
  // We lock into stacked layout once triggered, and release only when input is
  // cleared completely (e.g. after submit or user deletion).
  const [sizeRef, textareaRect] = useResizeObserver<HTMLTextAreaElement>();
  const mergedTextareaRef = useMergedRef(textareaRef, sizeRef);
  const baselineHeight = useRef<number | null>(null);
  if (baselineHeight.current === null && textareaRect.height > 0) {
    baselineHeight.current = textareaRect.height;
  }
  const [isStacked, setIsStacked] = useState(false);

  useEffect(() => {
    if (text === "") {
      setIsStacked(false);
      return;
    }
    const hasNewlines = text.includes("\n");
    const heightGrew = baselineHeight.current !== null && textareaRect.height > baselineHeight.current + 4;
    if (!isStacked && (hasNewlines || heightGrew)) {
      setIsStacked(true);
    }
  }, [text, textareaRect.height, isStacked]);

  const isMultiline = isStacked;
  const atCursorRef = useRef<number | undefined>(undefined);
  // A branch hands back the message it branched from; loading it into the
  // input is the point of branching. Keyed on object identity so the same
  // text can be re-loaded by a later branch.
  useEffect(() => {
    if (draft) setText(draft.text);
  }, [draft]);

  // Insert a file picked from the command palette.
  useEffect(() => {
    if (!insertedFile) return;
    const file = insertedFile.path;
    const formatted = file.includes(" ") ? `@"${file}" ` : `@${file} `;
    setText(current => {
      const atPos = atCursorRef.current;
      atCursorRef.current = undefined;
      if (atPos !== undefined && atPos > 0 && current[atPos - 1] === "@") {
        const before = current.slice(0, atPos - 1);
        const after = current.slice(atPos);
        return `${before}${formatted}${after}`;
      }
      if (current.endsWith("@")) {
        return `${current.slice(0, -1)}${formatted}`;
      }
      if (!current) {
        return formatted;
      }
      if (current.endsWith(" ")) {
        return `${current}${formatted}`;
      }
      return `${current} ${formatted}`;
    });
    textareaRef.current?.focus();
  }, [insertedFile]);
  // Stable dictation commit callback avoids re-binding speech recognition listeners.
  const onDictationCommit = useCallback((phrase: string) => {
    if (!phrase) return;
    setText(current => (current ? `${current} ${phrase}` : phrase));
  }, []);
  const dictation = useDictation(onDictationCommit);

  /** Read the picked files into memory, refusing the ones too big to send. */
  const attach = async (picked: FileList | null): Promise<void> => {
    if (!picked?.length) return;
    const accepted: Attached[] = [];
    const refused: string[] = [];
    for (const file of Array.from(picked)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        refused.push(`${file.name} (${formatSize(file.size)})`);
        continue;
      }
      accepted.push({ id: `${file.name}:${file.size}:${file.lastModified}`, file });
    }
    setReadError(
      refused.length > 0
        ? `Too large to attach, ${formatSize(MAX_ATTACHMENT_BYTES)} max: ${refused.join(", ")}`
        : undefined,
    );
    // Same file picked twice is one attachment, not two.
    setFiles(current => {
      const seen = new Set(current.map(entry => entry.id));
      return [...current, ...accepted.filter(entry => !seen.has(entry.id))];
    });
  };

  const send = (): void => {
    const message = text.trim();
    if (!message || !state) return;
    // Offline is no longer a reason to refuse. The send is parked in the
    // outbox and delivered when the network returns, so clearing the input
    // does not lose the message — it hands it over.
    // Encoding is async, so the input is not cleared until the bytes are in
    // hand — a read that fails must not take the message with it either.
    void Promise.all(files.map(entry => encode(entry.file)))
      .then(attachments => {
        onSend(message, running ? deliverAs : undefined, attachments.length > 0 ? attachments : undefined);
        setText("");
        setIsStacked(false);
        setFiles([]);
        setReadError(undefined);
        if (dictation.listening) dictation.stop();
      })
      .catch((error: unknown) => {
        setReadError(error instanceof Error ? error.message : "Could not read the attached files.");
      });
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

  const attachButton = (
    <Tooltip label="Attach files" position="top">
      <ActionIcon
        size="xl"
        variant="transparent"
        color="gray"
        disabled={disabled}
        onClick={() => picker.current?.click()}
        aria-label="Attach files"
      >
        <IconPaperclip size={22} />
      </ActionIcon>
    </Tooltip>
  );

  const actionButton =
    running && text.trim() ? (
      <>
        <Tooltip
          label={
            offline
              ? "No network. This will be sent when it is back."
              : `${MODE_HINT[mode]} Ctrl+Enter sends.`
          }
          position="left"
        >
          <ActionIcon
            size="xl"
            radius="md"
            variant="filled"
            color={mode === "plan" ? "cyan" : "plum"}
            disabled={disabled}
            onClick={send}
            aria-label={offline ? "Queue message" : "Send message"}
          >
            {offline ? <IconClockPause size={22} /> : <IconArrowUp size={22} />}
          </ActionIcon>
        </Tooltip>
        <Tooltip label="Interrupt the assistant" position="left">
          <ActionIcon size="xl" radius="md" variant="filled" color="red" onClick={onAbort}>
            <IconPlayerStopFilled size={22} />
          </ActionIcon>
        </Tooltip>
      </>
    ) : running ? (
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
    ) : text.trim() ? (
      <Tooltip
        label={
          offline
            ? "No network. Your message is queued and sent as soon as the connection is back."
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
          disabled={disabled}
          onClick={send}
          aria-label={offline ? "Queue message" : "Send message"}
        >
          {offline ? <IconClockPause size={22} /> : <IconArrowUp size={22} />}
        </ActionIcon>
      </Tooltip>
    ) : dictation.supported && !compact ? (
      <Tooltip label={dictation.listening ? "Stop dictation" : "Dictate"} position="left">
        <ActionIcon
          size="xl"
          radius="md"
          variant={dictation.listening ? "filled" : "light"}
          color={dictation.listening ? "cyan" : "gray"}
          disabled={disabled}
          onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}
          aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
          className={dictation.listening ? "omega-pulse" : undefined}
        >
          {dictation.listening ? <IconMicrophoneOff size={22} /> : <IconMicrophone size={22} />}
        </ActionIcon>
      </Tooltip>
    ) : (
      <ActionIcon size="xl" radius="md" variant="light" color="gray" disabled>
        <IconMicrophone size={22} />
      </ActionIcon>
    );

  return (
    <Paper
      className="omega-composer"
      p="sm"
      radius="md"
      withBorder
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      <Stack gap={8} className="omega-measure">
        {files.length > 0 ? (
          <Group gap={6} wrap="wrap">
            {files.map(entry => (
              <Pill
                key={entry.id}
                withRemoveButton
                onRemove={() => setFiles(current => current.filter(other => other.id !== entry.id))}
                size="md"
              >
                {entry.file.name}
                <Text span size="xs" c="dimmed" ml={6}>
                  {formatSize(entry.file.size)}
                </Text>
              </Pill>
            ))}
          </Group>
        ) : null}

        <Group gap={8} wrap="nowrap" align="stretch">
          <Textarea
            ref={mergedTextareaRef}
            flex={1}
            autosize
            minRows={1}
            maxRows={10}
            variant="unstyled"
            disabled={disabled}
            placeholder={disabled ? "Open a session to start" : "Message the agent…"}
            value={dictation.interim ? `${text} ${dictation.interim}`.trim() : text}
            onChange={event => {
              const next = event.currentTarget.value;
              const cursorPos = event.currentTarget.selectionStart ?? next.length;
              if (onSlash && text === "" && next === "/") {
                onSlash();
                return;
              }
              if (onAt) {
                const isFirstChar =
                  (text === "" && next === "@") || (cursorPos === 1 && next.startsWith("@"));
                const isSpaceThenAt =
                  (cursorPos >= 2 && next[cursorPos - 1] === "@" && next[cursorPos - 2] === " ") ||
                  (text.endsWith(" ") && next === `${text}@`);
                if (isFirstChar || isSpaceThenAt) {
                  atCursorRef.current = cursorPos;
                  setText(next);
                  onAt();
                  return;
                }
              }
              setText(next);
            }}
            onKeyDown={event => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              if (event.shiftKey) {
                // Shift+Enter must always write newline
                return;
              }
              if (event.ctrlKey || event.metaKey) {
                // Ctrl+Enter / Cmd+Enter must always submit
                event.preventDefault();
                send();
                return;
              }
              if (enterSubmits) {
                // Enter submits when the setting toggle is enabled
                event.preventDefault();
                send();
              }
            }}
            styles={{ input: { paddingTop: 4, paddingBottom: 4 } }}
          />

          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={event => {
              void attach(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          {isMultiline ? (
            <Stack gap={6} justify="flex-end" align="center" style={{ flexShrink: 0 }}>
              {attachButton}
              {actionButton}
            </Stack>
          ) : (
            <Group gap={6} align="center" style={{ flexShrink: 0 }}>
              {attachButton}
              {actionButton}
            </Group>
          )}
        </Group>

        <Group gap={8} wrap="wrap" justify="space-between" align="flex-end">
          <Group gap={8} wrap="nowrap" align="center">
            <Tooltip label={MODE_HINT[mode]} multiline w={240} position="top-start">
              <SegmentedControl
                size="xs"
                radius="md"
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
            {annotations > 0 && onOpenAnnotations ? (
              // Attached to the next send, like the queue above it — except
              // these are references the user marked up rather than messages.
              <Tooltip
                label="Notes marked up in files and surfaces. They are sent with your next message."
                position="top"
                multiline
                w={240}
              >
                <UnstyledButton
                  onClick={onOpenAnnotations}
                  aria-label="Open annotations"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
                >
                  <IconHighlight size={13} />
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}
                  >
                    {annotations} {annotations === 1 ? "annotation" : "annotations"}
                  </Text>
                </UnstyledButton>
              </Tooltip>
            ) : null}
            {outbox > 0 ? (
              // Distinct from the queue above it: those are waiting for the
              // agent, these are waiting for a network.
              <Tooltip
                label="Sent while offline. These go out as soon as the connection is back, even if you close this tab."
                position="top"
                multiline
                w={240}
              >
                <Group gap={4} wrap="nowrap" style={{ cursor: "default" }}>
                  <IconClockPause size={13} style={{ color: "var(--mantine-color-orange-4)" }} />
                  <Text size="xs" c="orange.4">
                    {outbox} waiting for network
                  </Text>
                </Group>
              </Tooltip>
            ) : null}
            {forcedTool ? (
              <Tooltip label="Next turn is forced to use this tool" position="top">
                <Badge
                  color="cyan"
                  size="xs"
                  variant="light"
                  leftSection={<IconBolt size={10} />}
                  rightSection={
                    onClearForcedTool ? (
                      <ActionIcon
                        size={12}
                        variant="transparent"
                        color="cyan"
                        onClick={onClearForcedTool}
                        aria-label="Clear forced tool"
                      >
                        <IconX size={8} />
                      </ActionIcon>
                    ) : undefined
                  }
                  style={{ textTransform: "none", fontFamily: "monospace" }}
                >
                  {forcedTool}
                </Badge>
              </Tooltip>
            ) : null}
          </Group>

          <Group gap={6} wrap="nowrap" align="center">
            {state ? (
              // One icon for the pair, not one each: the model and how hard it
              // thinks are a single setting in the reader's head, and two
              // glyphs six pixels apart read as two unrelated controls.
              <>
                <IconBrain size={13} style={{ color: "var(--mantine-color-dimmed)", flexShrink: 0 }} />
                <Tooltip label="Change model (/switch)" position="top-end">
                  <UnstyledButton
                    onClick={onChangeModel}
                    aria-label="Change model"
                    style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", minWidth: 0 }}
                  >
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
                <Text size="xs" c="dimmed" style={{ opacity: 0.4, flexShrink: 0 }}>
                  ·
                </Text>
                <Tooltip label="Change thinking level (/think)" position="top-end">
                  <UnstyledButton
                    onClick={onChangeThinking}
                    aria-label="Change thinking level"
                    style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                  >
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ textDecoration: "underline", textUnderlineOffset: "3px" }}
                    >
                      {state.thinkingLevel ?? "off"}
                    </Text>
                  </UnstyledButton>
                </Tooltip>
              </>
            ) : null}
          </Group>
        </Group>

        {dictation.error ? (
          <Text size="xs" c="red.4">
            {dictation.error}
          </Text>
        ) : null}

        {readError ? (
          <Text size="xs" c="red.4">
            {readError}
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}
