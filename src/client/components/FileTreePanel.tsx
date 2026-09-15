/**
 * The FileTree Panel.
 *
 * Displays a hierarchical directory tree for the active workspace with real-time
 * git status markers and colors (VSCode style). Supports folder expand/collapse
 * with persistence in localStorage per project, search filtering, and file selection.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import {
  IconBraces,
  IconBrandCss3,
  IconBrandHtml5,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandTypescript,
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconFile,
  IconFileText,
  IconFolder,
  IconFolderMinus,
  IconFolderOpen,
  IconFolderPlus,
  IconGitBranch,
  IconPhoto,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { GitFileStatus, GitStatusResult } from "../api/model.ts";

export interface FileTreePanelProps {
  /** All workspace files (relative paths). */
  files: string[];
  /** Current git status result for the workspace. */
  gitStatus?: GitStatusResult;
  /** Project identifier used for scoped localstorage persistence. */
  projectKey: string;
  /** Display name of the active project or workspace. */
  workspaceName?: string;
  /** Insert `@<path>` reference into the composer (+ button). */
  onInsertRef?: (path: string) => void;
  /** Open file in the file viewer drawer (looking glass or row click). */
  onOpenFile?: (path: string) => void;
  /** Callback to refresh files and git status. */
  onRefresh?: () => void;
  /** Close the drawer. */
  onClose?: () => void;
}

export type TreeGitStatus = "modified" | "untracked" | "added" | "deleted" | "conflict";

export interface TreeDirSummary {
  totalChanges: number;
  modifiedCount: number;
  untrackedCount: number;
  addedCount: number;
  deletedCount: number;
  conflictCount: number;
  dominantStatus?: TreeGitStatus;
  dominantMarker?: string;
}

/** Internal tree node structure. */
export interface TreeNode {
  id: string;
  name: string;
  path: string;
  isDirectory: boolean;
  children: TreeNode[];
  gitStatus?: GitFileStatus;
  summary?: TreeDirSummary;
}
/** VSCode git status colors and markers */
const GIT_STATUS_STYLE: Record<string, { color: string; label: string; textDecoration?: string }> = {
  modified: { color: "#e2c08d", label: "Modified" },
  untracked: { color: "#73c991", label: "Untracked" },
  added: { color: "#73c991", label: "Added" },
  deleted: { color: "#f48771", label: "Deleted", textDecoration: "line-through" },
  renamed: { color: "#70a5eb", label: "Renamed" },
  copied: { color: "#70a5eb", label: "Copied" },
  conflict: { color: "#e06c75", label: "Conflict" },
  ignored: { color: "var(--mantine-color-slate-5)", label: "Ignored" },
};

function getFileIcon(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return <IconBrandTypescript size={15} color="#3178c6" />;
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return <IconBrandJavascript size={15} color="#f7df1e" />;
    case "json":
      return <IconBraces size={15} color="#cbcb41" />;
    case "css":
    case "scss":
    case "less":
      return <IconBrandCss3 size={15} color="#42a5f5" />;
    case "html":
      return <IconBrandHtml5 size={15} color="#e44d26" />;
    case "md":
    case "markdown":
    case "txt":
      return <IconFileText size={15} color="#858585" />;
    case "py":
      return <IconBrandPython size={15} color="#3572A5" />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
      return <IconPhoto size={15} color="#b392f0" />;
    default:
      return <IconFile size={15} color="var(--mantine-color-slate-4)" />;
  }
}

/** Build hierarchical tree from flat list of files and git status entries. */
function buildTree(files: string[], gitStatus?: GitStatusResult): TreeNode[] {
  const rootNodes: TreeNode[] = [];
  const dirMap = new Map<string, TreeNode>();

  // Collect all unique file paths from file list and git status
  const allPaths = new Set<string>(files);
  if (gitStatus?.files) {
    for (const filePath of Object.keys(gitStatus.files)) {
      if (filePath) allPaths.add(filePath);
    }
  }

  function getOrCreateDir(dirPath: string): TreeNode {
    const existing = dirMap.get(dirPath);
    if (existing) return existing;

    const parts = dirPath.split("/");
    const name = parts[parts.length - 1] ?? dirPath;
    const node: TreeNode = {
      id: dirPath,
      name,
      path: dirPath,
      isDirectory: true,
      children: [],
    };
    dirMap.set(dirPath, node);

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join("/");
      const parent = getOrCreateDir(parentPath);
      parent.children.push(node);
    } else {
      rootNodes.push(node);
    }

    return node;
  }

  for (const filePath of allPaths) {
    const parts = filePath.split("/");
    const fileName = parts[parts.length - 1] ?? filePath;
    const fileGitStatus = gitStatus?.files?.[filePath];

    const fileNode: TreeNode = {
      id: filePath,
      name: fileName,
      path: filePath,
      isDirectory: false,
      children: [],
      gitStatus: fileGitStatus,
    };

    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join("/");
      const parentDir = getOrCreateDir(parentPath);
      parentDir.children.push(fileNode);
    } else {
      rootNodes.push(fileNode);
    }
  }

  // Sort and aggregate summary statistics recursively
  function processNode(node: TreeNode): void {
    if (!node.isDirectory) return;

    let modifiedCount = 0;
    let untrackedCount = 0;
    let addedCount = 0;
    let deletedCount = 0;
    let conflictCount = 0;

    for (const child of node.children) {
      if (child.isDirectory) {
        processNode(child);
        if (child.summary) {
          modifiedCount += child.summary.modifiedCount;
          untrackedCount += child.summary.untrackedCount;
          addedCount += child.summary.addedCount;
          deletedCount += child.summary.deletedCount;
          conflictCount += child.summary.conflictCount;
        }
      } else if (child.gitStatus) {
        const s = child.gitStatus.status;
        if (s === "modified") modifiedCount++;
        else if (s === "untracked") untrackedCount++;
        else if (s === "added") addedCount++;
        else if (s === "deleted") deletedCount++;
        else if (s === "conflict") conflictCount++;
      }
    }

    const totalChanges = modifiedCount + untrackedCount + addedCount + deletedCount + conflictCount;

    let dominantStatus: TreeGitStatus | undefined;
    let dominantMarker: string | undefined;

    if (conflictCount > 0) {
      dominantStatus = "conflict";
      dominantMarker = "!";
    } else if (modifiedCount > 0 || addedCount > 0) {
      dominantStatus = "modified";
      dominantMarker = "M";
    } else if (untrackedCount > 0) {
      dominantStatus = "untracked";
      dominantMarker = "U";
    } else if (deletedCount > 0) {
      dominantStatus = "deleted";
      dominantMarker = "D";
    }

    node.summary = {
      totalChanges,
      modifiedCount,
      untrackedCount,
      addedCount,
      deletedCount,
      conflictCount,
      dominantStatus,
      dominantMarker,
    };

    // Sort: directories first, then alphabetical (case-insensitive)
    node.children.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
    });
  }

  rootNodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  });

  for (const rootNode of rootNodes) {
    processNode(rootNode);
  }

  return rootNodes;
}

/** Collect all directory paths from tree nodes. */
function collectAllDirPaths(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.isDirectory) {
      acc.push(node.path);
      collectAllDirPaths(node.children, acc);
    }
  }
  return acc;
}

export function FileTreePanel({
  files,
  gitStatus,
  projectKey,
  workspaceName,
  onInsertRef,
  onOpenFile,
  onRefresh,
  onClose,
}: FileTreePanelProps) {
  const storageKey = `omega:filetree:expanded:${projectKey || "root"}`;
  const [filterQuery, setFilterQuery] = useState("");

  // Build the hierarchical tree
  const tree = useMemo(() => buildTree(files, gitStatus), [files, gitStatus]);

  // Persisted per project; falls back to expanding top-level directories the
  // first time a project is seen (or after its storage entry is cleared).
  const [expandedPaths, setExpandedPaths] = useLocalStorage<Set<string>>({
    key: storageKey,
    defaultValue: new Set(tree.filter(n => n.isDirectory).map(n => n.path)),
    serialize: value => JSON.stringify(Array.from(value)),
    deserialize: raw => {
      if (raw === undefined) return new Set();
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? new Set(parsed) : new Set();
      } catch {
        return new Set();
      }
    },
  });

  const toggleExpand = useCallback(
    (dirPath: string) => {
      const next = new Set(expandedPaths);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      setExpandedPaths(next);
    },
    [expandedPaths, setExpandedPaths],
  );

  const handleExpandAll = useCallback(() => {
    const allDirs = collectAllDirPaths(tree);
    setExpandedPaths(new Set(allDirs));
  }, [tree, setExpandedPaths]);

  const handleCollapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, [setExpandedPaths]);

  // Filter tree matching search query
  const query = filterQuery.trim().toLowerCase();
  const filterActive = query.length > 0;

  const visibleNodes = useMemo(() => {
    if (!filterActive) return tree;

    function filterNode(node: TreeNode): TreeNode | null {
      const matchesSelf = node.name.toLowerCase().includes(query) || node.path.toLowerCase().includes(query);
      if (!node.isDirectory) {
        return matchesSelf ? node : null;
      }

      const filteredChildren: TreeNode[] = [];
      for (const child of node.children) {
        const filtered = filterNode(child);
        if (filtered) filteredChildren.push(filtered);
      }

      if (matchesSelf || filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
      return null;
    }

    return tree.map(filterNode).filter((n): n is TreeNode => n !== null);
  }, [tree, filterActive, query]);

  // Calculate git change counts
  const totalChanges = gitStatus ? Object.keys(gitStatus.files).length : 0;
  const branchName = gitStatus?.branch;

  // Render a single tree node row
  const renderNode = (node: TreeNode, depth = 0) => {
    const isExpanded = filterActive || expandedPaths.has(node.path);
    const gitInfo = node.gitStatus;
    const styleInfo = gitInfo ? GIT_STATUS_STYLE[gitInfo.status] : undefined;
    const dirSummary = node.isDirectory ? node.summary : undefined;
    const dominantStatus = dirSummary?.dominantStatus;
    const dirStyleInfo = dominantStatus ? GIT_STATUS_STYLE[dominantStatus] : undefined;

    const labelColor = styleInfo?.color ?? (dirStyleInfo?.color ? dirStyleInfo.color : undefined);
    const textDecoration = styleInfo?.textDecoration;

    return (
      <Box key={node.id}>
        <UnstyledButton
          className="omega-filetree-row"
          style={{
            paddingLeft: depth * 14 + 8,
          }}
          onClick={() => {
            if (node.isDirectory) {
              toggleExpand(node.path);
            } else {
              onOpenFile?.(node.path);
            }
          }}
          aria-label={node.isDirectory ? `Toggle ${node.name}` : `Open ${node.path}`}
        >
          <Group gap={6} wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
            {node.isDirectory ? (
              <Box style={{ display: "flex", alignItems: "center", color: "var(--mantine-color-slate-4)" }}>
                {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
              </Box>
            ) : (
              <Box style={{ width: 14 }} />
            )}

            <Box style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
              {node.isDirectory ? (
                isExpanded ? (
                  <IconFolderOpen size={16} color="var(--mantine-color-plum-4)" />
                ) : (
                  <IconFolder size={16} color="var(--mantine-color-slate-3)" />
                )
              ) : (
                getFileIcon(node.name)
              )}
            </Box>

            <Text
              size="xs"
              truncate
              style={{
                color: labelColor,
                textDecoration,
                flex: 1,
                fontFamily: "var(--mantine-font-family-monospace)",
                fontSize: 12,
              }}
            >
              {node.name}
            </Text>

            {/* Git Status Marker / Badge */}
            {!node.isDirectory && gitInfo ? (
              <Tooltip label={`${styleInfo?.label ?? gitInfo.status}: ${node.path}`}>
                <Text
                  size="10px"
                  fw={700}
                  style={{
                    color: styleInfo?.color ?? "#e2c08d",
                    fontFamily: "var(--mantine-font-family-monospace)",
                    padding: "0 2px",
                    flexShrink: 0,
                  }}
                >
                  {gitInfo.marker}
                </Text>
              </Tooltip>
            ) : null}

            {/* Directory Git Summary Badge when collapsed or dirty */}
            {node.isDirectory && dirSummary && dirSummary.totalChanges > 0 ? (
              <Tooltip
                label={`${dirSummary.totalChanges} changed file${dirSummary.totalChanges > 1 ? "s" : ""} in ${node.name}`}
              >
                <Text
                  size="10px"
                  fw={700}
                  style={{
                    color: dirStyleInfo?.color ?? "#e2c08d",
                    fontFamily: "var(--mantine-font-family-monospace)",
                    padding: "0 2px",
                    flexShrink: 0,
                  }}
                >
                  {dirSummary.dominantMarker ?? "M"}
                </Text>
              </Tooltip>
            ) : null}

            {/* File action buttons on hover: looking glass (open) and + (insert ref) */}
            {!node.isDirectory ? (
              <Group gap={2} wrap="nowrap" style={{ flexShrink: 0 }}>
                {onInsertRef ? (
                  <Tooltip label="Insert @ reference in message">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="plum"
                      className="omega-filetree-action-btn"
                      onClick={e => {
                        e.stopPropagation();
                        onInsertRef(node.path);
                      }}
                      aria-label={`Insert @${node.path} reference`}
                    >
                      <IconPlus size={13} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
                {onOpenFile ? (
                  <Tooltip label="Open in file viewer">
                    <ActionIcon
                      size="xs"
                      variant="subtle"
                      color="cyan"
                      className="omega-filetree-action-btn"
                      onClick={e => {
                        e.stopPropagation();
                        onOpenFile(node.path);
                      }}
                      aria-label={`Open ${node.path} in viewer`}
                    >
                      <IconEye size={13} />
                    </ActionIcon>
                  </Tooltip>
                ) : null}
              </Group>
            ) : null}
          </Group>
        </UnstyledButton>

        {node.isDirectory && isExpanded && node.children.length > 0 ? (
          <Box className="omega-filetree-children">
            {node.children.map(child => renderNode(child, depth + 1))}
          </Box>
        ) : null}
      </Box>
    );
  };

  return (
    <Stack gap={0} h="100%">
      {/* Header */}
      <Paper h={56} withBorder radius={0} style={{ borderLeft: 0, borderRight: 0, borderTop: 0 }}>
        <Group justify="space-between" align="center" wrap="nowrap" h="100%" px="sm">
          <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
            <IconFolderOpen size={18} color="var(--mantine-color-plum-4)" />
            <Text size="sm" fw={700} truncate>
              {workspaceName || "Files"}
            </Text>
            {branchName ? (
              <Badge
                size="xs"
                variant="light"
                color="slate"
                leftSection={<IconGitBranch size={11} />}
                style={{ flexShrink: 0 }}
              >
                {branchName}
              </Badge>
            ) : null}
            {totalChanges > 0 ? (
              <Badge size="xs" variant="light" color="yellow" style={{ flexShrink: 0 }}>
                {totalChanges} changed
              </Badge>
            ) : null}
          </Group>

          <Group gap={4} wrap="nowrap">
            <Tooltip label="Collapse all folders">
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={handleCollapseAll}
                aria-label="Collapse all folders"
              >
                <IconFolderMinus size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Expand all folders">
              <ActionIcon
                size="sm"
                variant="subtle"
                onClick={handleExpandAll}
                aria-label="Expand all folders"
              >
                <IconFolderPlus size={15} />
              </ActionIcon>
            </Tooltip>
            {onRefresh ? (
              <Tooltip label="Refresh file tree & git status">
                <ActionIcon size="sm" variant="subtle" onClick={onRefresh} aria-label="Refresh files">
                  <IconRefresh size={15} />
                </ActionIcon>
              </Tooltip>
            ) : null}
            {onClose ? (
              <ActionIcon size="sm" variant="subtle" onClick={onClose} aria-label="Close file tree panel">
                <IconX size={16} />
              </ActionIcon>
            ) : null}
          </Group>
        </Group>
      </Paper>

      {/* Filter Input */}
      <Box px="sm" py="xs" style={{ borderBottom: "1px solid var(--omega-line)" }}>
        <TextInput
          size="xs"
          placeholder="Filter files..."
          leftSection={<IconSearch size={14} />}
          rightSection={
            filterQuery ? (
              <ActionIcon
                size="xs"
                variant="subtle"
                onClick={() => setFilterQuery("")}
                aria-label="Clear filter"
              >
                <IconX size={12} />
              </ActionIcon>
            ) : null
          }
          value={filterQuery}
          onChange={e => setFilterQuery(e.currentTarget.value)}
        />
      </Box>

      {/* Tree Content */}
      <ScrollArea style={{ flex: 1 }} p={4} type="auto">
        {visibleNodes.length === 0 ? (
          <Stack align="center" justify="center" py="xl" gap="sm">
            <ThemeIcon size={40} radius="xl" variant="light" color="slate">
              <IconFile size={24} />
            </ThemeIcon>
            <Text size="sm" c="dimmed" ta="center" px="md">
              {filterActive ? "No matching files found" : "No files in workspace"}
            </Text>
          </Stack>
        ) : (
          <Box py={2}>{visibleNodes.map(node => renderNode(node, 0))}</Box>
        )}
      </ScrollArea>
    </Stack>
  );
}
