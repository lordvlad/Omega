/**
 * File Viewer Panel.
 *
 * Renders file content with syntax highlighting, markdown preview, image viewer,
 * and git status decorations. Supports dropping `@` references into the composer.
 */
import { CodeHighlight } from "@mantine/code-highlight";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { useTimeout } from "@mantine/hooks";
import {
  IconAlertCircle,
  IconBrandCss3,
  IconBrandHtml5,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandTypescript,
  IconBraces,
  IconCheck,
  IconCopy,
  IconFile,
  IconFileText,
  IconPhoto,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import type { GitFileStatus } from "../api/model.ts";
import { useGetFileContent } from "../api/queries.ts";
import { copyText } from "../lib/clipboard.ts";
import { Markdown } from "../lib/markdown.tsx";

export interface FileViewerProps {
  /** Relative path of the file to inspect. */
  filePath: string | null;
  /** Workspace directory cwd. */
  cwd?: string;
  /** Git status for this file, if modified/untracked. */
  gitStatus?: GitFileStatus;
  /** Insert `@<path>` reference into the composer. */
  onInsertRef?: (path: string) => void;
  /** Close the viewer drawer. */
  onClose?: () => void;
}

const LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "css",
  html: "html",
  htm: "html",
  py: "python",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  diff: "diff",
  patch: "diff",
};

const GIT_STATUS_STYLE: Record<string, { color: string; label: string }> = {
  modified: { color: "#e2c08d", label: "Modified" },
  untracked: { color: "#73c991", label: "Untracked" },
  added: { color: "#73c991", label: "Added" },
  deleted: { color: "#f48771", label: "Deleted" },
  renamed: { color: "#70a5eb", label: "Renamed" },
  conflict: { color: "#e06c75", label: "Conflict" },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return <IconBrandTypescript size={18} color="#3178c6" />;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <IconBrandJavascript size={18} color="#f7df1e" />;
    case "json":
      return <IconBraces size={18} color="#cbcb41" />;
    case "css":
    case "scss":
    case "less":
      return <IconBrandCss3 size={18} color="#42a5f5" />;
    case "html":
      return <IconBrandHtml5 size={18} color="#e44d26" />;
    case "md":
    case "markdown":
    case "txt":
      return <IconFileText size={18} color="#858585" />;
    case "py":
      return <IconBrandPython size={18} color="#3572A5" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return <IconPhoto size={18} color="#b392f0" />;
    default:
      return <IconFile size={18} color="var(--mantine-color-slate-4)" />;
  }
}

export function FileViewer({ filePath, cwd, gitStatus, onInsertRef, onClose }: FileViewerProps) {
  const [copiedContent, setCopiedContent] = useState(false);
  const [markdownView, setMarkdownView] = useState<"rendered" | "raw">("rendered");
  const query = useGetFileContent(
    { query: { path: filePath ?? "", cwd } },
    { enabled: Boolean(filePath), staleTime: 10_000 },
  );

  const fileData = query.data;
  const fileName = filePath ? (filePath.split("/").pop() ?? filePath) : "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown = ext === "md" || ext === "markdown";
  const language = LANGUAGE_MAP[ext] ?? "text";

  const lineCount = useMemo(() => {
    if (!fileData?.content) return 0;
    return fileData.content.split("\n").length;
  }, [fileData?.content]);

  const copiedReset = useTimeout(() => setCopiedContent(false), 1500);
  const handleCopy = () => {
    if (fileData?.content) {
      void copyText(fileData.content);
      setCopiedContent(true);
      copiedReset.clear();
      copiedReset.start();
    }
  };

  const statusStyle = gitStatus ? GIT_STATUS_STYLE[gitStatus.status] : undefined;

  return (
    <Stack gap={0} h="100%">
      {/* Header */}
      <Paper h={56} withBorder radius={0} style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Group justify="space-between" align="center" wrap="nowrap" h="100%" px="sm">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            {getFileIcon(fileName)}
            <Text size="sm" fw={700} truncate style={{ fontFamily: "var(--mantine-font-family-monospace)" }}>
              {filePath || "No file selected"}
            </Text>

            {fileData ? (
              <Badge size="xs" variant="light" color="slate">
                {formatBytes(fileData.size)}
              </Badge>
            ) : null}

            {lineCount > 0 ? (
              <Badge size="xs" variant="outline" color="slate">
                {lineCount} lines
              </Badge>
            ) : null}

            {statusStyle ? (
              <Badge
                size="xs"
                variant="light"
                style={{
                  color: statusStyle.color,
                  backgroundColor: `color-mix(in srgb, ${statusStyle.color} 15%, transparent)`,
                }}
              >
                {gitStatus?.marker} {statusStyle.label}
              </Badge>
            ) : null}
          </Group>

          <Group gap={6} wrap="nowrap">
            {isMarkdown && fileData?.content ? (
              <SegmentedControl
                size="xs"
                value={markdownView}
                onChange={v => setMarkdownView(v as "rendered" | "raw")}
                data={[
                  { label: "Preview", value: "rendered" },
                  { label: "Raw", value: "raw" },
                ]}
              />
            ) : null}

            {onInsertRef && filePath ? (
              <Tooltip label="Insert @ reference in composer">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="plum"
                  onClick={() => onInsertRef(filePath)}
                  aria-label="Insert file reference in message"
                >
                  <IconPlus size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}

            {fileData?.content ? (
              <Tooltip label={copiedContent ? "Copied!" : "Copy content"}>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color={copiedContent ? "cyan" : "slate"}
                  onClick={handleCopy}
                  aria-label="Copy file content"
                >
                  {copiedContent ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            ) : null}

            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close file viewer">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Paper>

      {/* Content Area */}
      <Box style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {query.isLoading ? (
          <Center h="100%">
            <Stack align="center" gap="sm">
              <Loader size="md" color="plum" />
              <Text size="xs" c="dimmed">
                Loading {filePath}...
              </Text>
            </Stack>
          </Center>
        ) : query.isError ? (
          <Center h="100%" p="md">
            <Alert
              icon={<IconAlertCircle size={16} />}
              title="Error loading file"
              color="red"
              variant="light"
            >
              {query.error instanceof Error ? query.error.message : "Unable to read file content"}
            </Alert>
          </Center>
        ) : fileData?.isImage && fileData.dataUrl ? (
          <Center h="100%" p="md" style={{ background: "rgba(0, 0, 0, 0.2)" }}>
            <img
              src={fileData.dataUrl}
              alt={fileName}
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                objectFit: "contain",
                borderRadius: 4,
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
              }}
            />
          </Center>
        ) : fileData?.isBinary ? (
          <Center h="100%" p="md">
            <Stack align="center" gap="xs">
              <ThemeIcon size={44} radius="xl" variant="light" color="slate">
                <IconFile size={24} />
              </ThemeIcon>
              <Text size="sm" c="dimmed" ta="center">
                Binary file ({fileData.mimeType}) cannot be previewed.
              </Text>
              <Text size="xs" c="dimmed">
                Size: {formatBytes(fileData.size)}
              </Text>
            </Stack>
          </Center>
        ) : isMarkdown && markdownView === "rendered" && fileData?.content ? (
          <ScrollArea style={{ height: "100%" }} p="md">
            <Box className="omega-markdown" style={{ maxWidth: 900, margin: "0 auto" }}>
              <Markdown text={fileData.content} />
            </Box>
          </ScrollArea>
        ) : fileData?.content != null ? (
          <ScrollArea style={{ height: "100%" }} type="auto">
            <Box p="xs">
              <CodeHighlight code={fileData.content} language={language} withCopyButton={false} />
            </Box>
          </ScrollArea>
        ) : (
          <Center h="100%">
            <Text size="sm" c="dimmed">
              File is empty
            </Text>
          </Center>
        )}
      </Box>
    </Stack>
  );
}
