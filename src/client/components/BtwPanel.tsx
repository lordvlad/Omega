import React, { useState } from "react";
import { IconCopy, IconHelp, IconMessageQuestion, IconSend, IconX } from "@tabler/icons-react";
/**
 * BTW panel: transient side-questions answered without polluting the conversation transcript.
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
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { copyText } from "../lib/clipboard.ts";
import { Markdown } from "../lib/markdown.tsx";

export interface BtwTurn {
  question: string;
  answer?: string;
  loading?: boolean;
  error?: string;
}

export interface BtwPanelProps {
  turns: BtwTurn[];
  onAsk: (question: string) => void;
  onClose?: () => void;
}

export function BtwPanel({ turns, onAsk, onClose }: BtwPanelProps): React.ReactNode {
  const [input, setInput] = useState("");

  const handleSubmit = (e?: React.SyntheticEvent): void => {
    e?.preventDefault();
    const q = input.trim();
    if (!q) {
      return;
    }
    onAsk(q);
    setInput("");
  };

  const handleCopy = async (answer: string): Promise<void> => {
    const ok = await copyText(answer);
    if (ok) {
      notifications.show({
        color: "cyan",
        title: "Copied",
        message: "Answer copied to clipboard.",
        autoClose: 2000,
      });
    }
  };

  return (
    <Stack gap={0} h="100%">
      <Box p="md" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <Group justify="space-between" align="center" wrap="nowrap">
          <Group gap="xs" wrap="nowrap">
            <ThemeIcon size="md" radius="sm" variant="light" color="cyan">
              <IconMessageQuestion size={18} />
            </ThemeIcon>
            <Text size="sm" fw={700}>
              By The Way (/btw)
            </Text>
            <Badge size="xs" variant="light" color="cyan">
              Transient Q&A
            </Badge>
          </Group>
          {onClose ? (
            <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close BTW panel">
              <IconX size={16} />
            </ActionIcon>
          ) : null}
        </Group>
      </Box>

      <ScrollArea style={{ flex: 1 }} p="md">
        {turns.length === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="xs">
            <IconHelp size={32} color="var(--mantine-color-dimmed)" />
            <Text size="sm" c="dimmed" ta="center">
              Ask any quick side question against current context.
            </Text>
            <Text size="xs" c="dimmed" ta="center">
              Answers are transient and won't be saved to the conversation history.
            </Text>
          </Stack>
        ) : (
          <Stack gap="md">
            {turns.map((turn, index) => (
              <Card key={index} withBorder radius="md" p="sm" shadow="xs">
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Text size="xs" fw={700} c="cyan.4">
                      Q: {turn.question}
                    </Text>
                    {turn.answer ? (
                      <Tooltip label="Copy answer">
                        <ActionIcon
                          size="xs"
                          variant="subtle"
                          color="gray"
                          onClick={() => handleCopy(turn.answer!)}
                          aria-label="Copy answer"
                        >
                          <IconCopy size={13} />
                        </ActionIcon>
                      </Tooltip>
                    ) : null}
                  </Group>

                  {turn.loading ? (
                    <Group gap="xs" py="xs">
                      <Loader size="xs" color="cyan" />
                      <Text size="xs" c="dimmed" className="omega-pulse">
                        Answering side-question…
                      </Text>
                    </Group>
                  ) : turn.error ? (
                    <Text size="xs" c="red.4">
                      {turn.error}
                    </Text>
                  ) : turn.answer ? (
                    <Box pt={4}>
                      <Markdown text={turn.answer} />
                    </Box>
                  ) : null}
                </Stack>
              </Card>
            ))}
          </Stack>
        )}
      </ScrollArea>

      <Box p="md" style={{ borderTop: "1px solid var(--omega-line)" }}>
        <form onSubmit={handleSubmit}>
          <Group gap="xs" wrap="nowrap">
            <TextInput
              style={{ flex: 1 }}
              size="xs"
              placeholder="Ask another side question…"
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              aria-label="Ask side question"
            />
            <Button
              size="xs"
              color="cyan"
              variant="filled"
              onClick={() => handleSubmit()}
              disabled={!input.trim()}
              leftSection={<IconSend size={12} />}
            >
              Ask
            </Button>
          </Group>
        </form>
      </Box>
    </Stack>
  );
}
