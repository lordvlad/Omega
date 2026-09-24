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
  Button,
  Center,
  Group,
  Loader,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
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
  IconDownload,
  IconFile,
  IconFileText,
  IconGitCommit,
  IconHighlight,
  IconPhoto,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { GitFileStatus } from "../api/model.ts";
import { useGetFileContent, useGetGitDiff } from "../api/queries.ts";
import { copyText } from "../lib/clipboard.ts";
import { Markdown } from "../lib/markdown.tsx";
import { getBasename } from "../lib/paths.ts";

/** What a selection in the viewer records, before the note is written. */
export interface FileSelectionAnnotation {
  path: string;
  view: "raw" | "diff" | "rendered";
  excerpt: string;
  startLine?: number;
  startChar?: number;
  endLine?: number;
  endChar?: number;
  fileLine?: number;
  side?: "new" | "old" | "meta";
  note: string;
}

export interface FileViewerProps {
  /** Relative path of the file to inspect. */
  filePath: string | null;
  /** Workspace directory cwd. */
  cwd?: string;
  /** Git status for this file, if modified/untracked. */
  gitStatus?: GitFileStatus;
  /** Insert `@<path>` reference into the composer. */
  onInsertRef?: (path: string) => void;
  /** Record a note against the selected text. Absent hides the popup. */
  onAnnotate?: (annotation: FileSelectionAnnotation) => void;
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

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u;

/**
 * Where a line of a unified diff sits in the real file.
 *
 * A diff is handed to the viewer as one string, so a selection in it knows
 * only its own line. Walking the hunk headers turns that back into a file
 * line, which is the number worth telling the agent: `-` lines count against
 * the old file, everything else against the new one, and anything outside a
 * hunk is header noise with no line of its own.
 */
function diffPosition(
  diffText: string,
  diffLine: number,
): { side: "new" | "old" | "meta"; fileLine?: number } {
  const lines = diffText.split("\n");
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const header = HUNK_HEADER.exec(line);
    if (header) {
      if (i + 1 === diffLine) return { side: "meta" };
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      inHunk = true;
      continue;
    }
    if (i + 1 === diffLine) {
      if (!inHunk) return { side: "meta" };
      if (line.startsWith("-")) return { side: "old", fileLine: oldNo };
      if (line.startsWith("+") || line.startsWith(" ")) return { side: "new", fileLine: newNo };
      return { side: "meta" };
    }
    if (!inHunk) continue;
    if (line.startsWith("+")) newNo++;
    else if (line.startsWith("-")) oldNo++;
    else if (line.startsWith(" ")) {
      newNo++;
      oldNo++;
    }
  }
  return { side: "meta" };
}

/** A live selection, with where to float the annotate popup over it. */
interface PendingSelection extends Omit<FileSelectionAnnotation, "note"> {
  top: number;
  left: number;
}

/** Longest excerpt stored with an annotation. */
const MAX_EXCERPT = 400;

export function FileViewer({ filePath, cwd, gitStatus, onInsertRef, onAnnotate, onClose }: FileViewerProps) {
  const isModified = Boolean(gitStatus && gitStatus.status);
  const fileName = filePath ? getBasename(filePath) : "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isMarkdown = ext === "md" || ext === "markdown";
  const language = LANGUAGE_MAP[ext] ?? "text";

  const [copiedContent, setCopiedContent] = useState(false);
  const [viewMode, setViewMode] = useState<"rendered" | "raw" | "diff">(isMarkdown ? "rendered" : "raw");

  useEffect(() => {
    setViewMode(isMarkdown ? "rendered" : "raw");
  }, [filePath, isMarkdown]);

  const query = useGetFileContent(
    { query: { path: filePath ?? "", cwd } },
    { enabled: Boolean(filePath), staleTime: 10_000 },
  );

  const diffQuery = useGetGitDiff(
    { query: { path: filePath ?? "", cwd } },
    { enabled: Boolean(filePath && isModified), staleTime: 10_000 },
  );

  const fileData = query.data;
  const diffData = diffQuery.data;

  const activeContent = viewMode === "diff" ? diffData?.diff : fileData?.content;

  const lineCount = useMemo(() => {
    if (!activeContent) return 0;
    return activeContent.split("\n").length;
  }, [activeContent]);

  const copiedReset = useTimeout(() => setCopiedContent(false), 1500);
  const handleCopy = () => {
    if (activeContent) {
      void copyText(activeContent);
      setCopiedContent(true);
      copiedReset.clear();
      copiedReset.start();
    }
  };

  const contentRef = useRef<HTMLDivElement>(null);
  /** The selection the annotate popup is floating over, if any. */
  const [pending, setPending] = useState<PendingSelection | null>(null);
  /** Non-null once the user asked to write the note. */
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  // A new file, or a new view of it, invalidates any pending selection: the
  // text it pointed at is no longer on screen.
  useEffect(() => {
    setPending(null);
    setNoteDraft(null);
  }, [filePath, viewMode]);

  /**
   * Turn the live selection into an annotation-shaped record.
   *
   * Line numbers come from character offsets rather than from the DOM:
   * `CodeHighlight` emits one `<pre>` of inline spans with no per-line
   * elements, so there is nothing to read a line off. It also normalizes the
   * code it renders, which would shift every number by a constant — hence
   * the drift correction against the string the viewer was handed.
   */
  const captureSelection = (): void => {
    // Mid-write, a stray selection change must not yank the editor away.
    if (noteDraft !== null) return;
    const host = contentRef.current;
    if (!host || !onAnnotate) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setPending(null);
      return;
    }
    const raw = selection.toString();
    if (!raw.trim()) {
      setPending(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!host.contains(range.commonAncestorContainer)) {
      setPending(null);
      return;
    }

    const box = host.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    const top = Math.min(Math.max(rect.bottom - box.top + 6, 4), Math.max(4, box.height - 48));
    const left = Math.min(Math.max(rect.left - box.left, 4), Math.max(4, box.width - 300));

    const view: FileSelectionAnnotation["view"] =
      viewMode === "diff" ? "diff" : viewMode === "rendered" ? "rendered" : "raw";

    let startLine: number | undefined;
    let startChar: number | undefined;
    let endLine: number | undefined;
    let endChar: number | undefined;
    let fileLine: number | undefined;
    let side: FileSelectionAnnotation["side"];

    const pre = view === "rendered" ? null : host.querySelector("pre");
    if (pre && pre.contains(range.startContainer)) {
      const probe = document.createRange();
      probe.setStart(pre, 0);
      probe.setEnd(range.startContainer, range.startOffset);
      const startOffset = probe.toString().length;
      const endOffset = startOffset + raw.length;
      const preText = pre.textContent ?? "";
      const source = activeContent ?? "";
      const anchor = preText.slice(0, 200);
      const anchorAt = anchor ? source.indexOf(anchor) : -1;
      const drift = anchorAt > 0 ? source.slice(0, anchorAt).split("\n").length - 1 : 0;

      const before = preText.slice(0, startOffset);
      startLine = before.split("\n").length + drift;
      startChar = startOffset - (before.lastIndexOf("\n") + 1) + 1;
      const beforeEnd = preText.slice(0, endOffset);
      endLine = beforeEnd.split("\n").length + drift;
      endChar = endOffset - (beforeEnd.lastIndexOf("\n") + 1) + 1;

      if (view === "diff") {
        const position = diffPosition(source, startLine);
        side = position.side;
        fileLine = position.fileLine;
      }
    }

    setPending({
      path: filePath ?? "",
      view,
      excerpt: raw.slice(0, MAX_EXCERPT),
      startLine,
      startChar,
      endLine,
      endChar,
      fileLine,
      side,
      top,
      left,
    });
  };

  const saveAnnotation = (): void => {
    const note = (noteDraft ?? "").trim();
    if (!pending || !note || !onAnnotate) return;
    const { top: _top, left: _left, ...annotation } = pending;
    onAnnotate({ ...annotation, note });
    setNoteDraft(null);
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const cancelAnnotation = (): void => {
    setNoteDraft(null);
    setPending(null);
  };
  const statusStyle = gitStatus ? GIT_STATUS_STYLE[gitStatus.status] : undefined;

  return (
    <Stack gap={0} h="100%">
      {/* Header */}
      <Paper
        h={56}
        withBorder
        radius={0}
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          borderLeft: 0,
          borderRight: 0,
          borderTop: 0,
          backgroundColor: "var(--mantine-color-body)",
          flexShrink: 0,
        }}
      >
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
            {isModified ? (
              isMarkdown ? (
                <SegmentedControl
                  size="xs"
                  value={viewMode}
                  onChange={v => setViewMode(v as "rendered" | "raw" | "diff")}
                  data={[
                    { label: "Preview", value: "rendered" },
                    { label: "Raw", value: "raw" },
                    { label: "Diff", value: "diff" },
                  ]}
                />
              ) : (
                <SegmentedControl
                  size="xs"
                  value={viewMode === "diff" ? "diff" : "file"}
                  onChange={v => setViewMode(v === "diff" ? "diff" : "raw")}
                  data={[
                    { label: "File", value: "file" },
                    { label: "Diff", value: "diff" },
                  ]}
                />
              )
            ) : isMarkdown && fileData?.content ? (
              <SegmentedControl
                size="xs"
                value={viewMode === "raw" ? "raw" : "rendered"}
                onChange={v => setViewMode(v as "rendered" | "raw")}
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
            {filePath ? (
              <Tooltip label="Download file">
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color="slate"
                  component="a"
                  href={`/api/files/download?path=${encodeURIComponent(filePath)}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ""}`}
                  download={fileName}
                  aria-label="Download file"
                >
                  <IconDownload size={16} />
                </ActionIcon>
              </Tooltip>
            ) : null}

            {activeContent ? (
              <Tooltip label={copiedContent ? "Copied!" : viewMode === "diff" ? "Copy diff" : "Copy content"}>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  color={copiedContent ? "cyan" : "slate"}
                  onClick={handleCopy}
                  aria-label={viewMode === "diff" ? "Copy diff" : "Copy file content"}
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
      <Box
        ref={contentRef}
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
        onMouseUp={captureSelection}
        onTouchEnd={captureSelection}
      >
        {viewMode === "diff" ? (
          diffQuery.isLoading ? (
            <Center h="100%">
              <Stack align="center" gap="sm">
                <Loader size="md" color="yellow" />
                <Text size="xs" c="dimmed">
                  Loading diff for {filePath}...
                </Text>
              </Stack>
            </Center>
          ) : diffQuery.isError ? (
            <Center h="100%" p="md">
              <Alert
                icon={<IconAlertCircle size={16} />}
                title="Error loading diff"
                color="red"
                variant="light"
              >
                {diffQuery.error instanceof Error ? diffQuery.error.message : "Unable to read git diff"}
              </Alert>
            </Center>
          ) : diffData?.isTooLarge ? (
            <Center h="100%" p="md">
              <Stack align="center" gap="sm" style={{ maxWidth: 420 }}>
                <ThemeIcon size={48} radius="xl" variant="light" color="orange">
                  <IconAlertCircle size={26} />
                </ThemeIcon>
                <Text size="sm" fw={600} ta="center">
                  Diff is too large to preview inline ({formatBytes(diffData.size ?? 0)})
                </Text>
                <Text size="xs" c="dimmed" ta="center">
                  Git diff exceeds 500 KB threshold.
                </Text>
              </Stack>
            </Center>
          ) : diffData?.diff ? (
            <ScrollArea style={{ height: "100%" }} type="auto">
              <Box p="xs">
                <CodeHighlight code={diffData.diff} language="diff" withCopyButton={false} />
              </Box>
            </ScrollArea>
          ) : (
            <Center h="100%">
              <Text size="sm" c="dimmed">
                No uncommitted git changes for this file
              </Text>
            </Center>
          )
        ) : query.isLoading ? (
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
        ) : fileData?.isTooLarge ? (
          <Center h="100%" p="md">
            <Stack align="center" gap="sm" style={{ maxWidth: 420 }}>
              <ThemeIcon size={48} radius="xl" variant="light" color="orange">
                <IconDownload size={26} />
              </ThemeIcon>
              <Text size="sm" fw={600} ta="center">
                File is too large to preview inline ({formatBytes(fileData.size)})
              </Text>
              <Text size="xs" c="dimmed" ta="center">
                Inline preview is capped at 500 KB to keep the browser responsive. You can download the full
                file to view or edit locally{isModified ? ", or view its git diff" : ""}.
              </Text>
              <Group gap="xs">
                <Button
                  size="sm"
                  color="cyan"
                  variant="filled"
                  leftSection={<IconDownload size={16} />}
                  component="a"
                  href={`/api/files/download?path=${encodeURIComponent(filePath ?? "")}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ""}`}
                  download={fileName}
                >
                  Download File ({formatBytes(fileData.size)})
                </Button>
                {isModified ? (
                  <Button
                    size="sm"
                    color="yellow"
                    variant="light"
                    leftSection={<IconGitCommit size={16} />}
                    onClick={() => setViewMode("diff")}
                  >
                    View Diff
                  </Button>
                ) : null}
              </Group>
              {onInsertRef && filePath ? (
                <Button
                  size="xs"
                  variant="subtle"
                  color="plum"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => onInsertRef(filePath)}
                >
                  Insert @{filePath} reference
                </Button>
              ) : null}
            </Stack>
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
        ) : isMarkdown && viewMode === "rendered" && fileData?.content ? (
          <ScrollArea style={{ height: "100%" }} p="md">
            <Box className="omega-markdown" style={{ maxWidth: 900, margin: "0 auto" }}>
              <Markdown text={fileData.content} baseFilePath={filePath ?? undefined} />
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

        {pending && onAnnotate ? (
          <Paper
            withBorder
            shadow="md"
            radius="sm"
            p={noteDraft === null ? 4 : "xs"}
            style={{
              position: "absolute",
              top: pending.top,
              left: pending.left,
              zIndex: 5,
              width: noteDraft === null ? undefined : 280,
            }}
            // The popup sits inside the box that listens for selections, so
            // clicking it would otherwise re-run the capture and close it.
            onMouseUp={event => event.stopPropagation()}
          >
            {noteDraft === null ? (
              <Button
                size="xs"
                variant="light"
                color="plum"
                leftSection={<IconHighlight size={13} />}
                onClick={() => setNoteDraft("")}
              >
                Annotate
              </Button>
            ) : (
              <Stack gap={6}>
                <Text size="xs" c="dimmed">
                  {pending.startLine !== undefined
                    ? `Lines ${pending.startLine}–${pending.endLine ?? pending.startLine}`
                    : "Selection"}
                </Text>
                <Textarea
                  autosize
                  size="xs"
                  minRows={2}
                  maxRows={6}
                  data-autofocus
                  autoFocus
                  value={noteDraft}
                  placeholder="What should the agent know about this?"
                  onChange={event => setNoteDraft(event.currentTarget.value)}
                  onKeyDown={event => {
                    // Same contract as the composer and the queue editor.
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelAnnotation();
                      return;
                    }
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    if (!event.ctrlKey && !event.metaKey) return;
                    event.preventDefault();
                    saveAnnotation();
                  }}
                  aria-label="Annotation text"
                />
                <Group gap={6} justify="flex-end">
                  <Button size="xs" variant="subtle" color="gray" onClick={cancelAnnotation}>
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="filled"
                    color="plum"
                    disabled={!noteDraft.trim()}
                    onClick={saveAnnotation}
                  >
                    Save
                  </Button>
                </Group>
              </Stack>
            )}
          </Paper>
        ) : null}
      </Box>
    </Stack>
  );
}
