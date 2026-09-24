import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconCornerLeftUp,
  IconEdit,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconFolderCheck,
  IconGitBranch,
  IconHome,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
/**
 * Interactive Directory Picker Modal.
 *
 * Provides visual filesystem navigation (breadcrumbs, subdirectories, parent traversal,
 * home/workspace shortcuts, search filtering, and git repository detection) to easily
 * choose or create a workspace directory without manual path typing.
 */
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useBrowseDirectory } from "../api/queries.ts";

export interface DirectoryPickerModalProps {
  opened: boolean;
  onClose: () => void;
  initialPath?: string;
  onSelectDirectory: (directoryPath: string) => void;
}

/** Break an absolute path into breadcrumb segments (cross-platform for Windows and POSIX). */
function pathSegments(fullPath: string): Array<{ name: string; path: string }> {
  if (!fullPath) {
    return [{ name: "/", path: "/" }];
  }

  const normalized = fullPath.replace(/\\/g, "/");
  const isWindows = /^[a-zA-Z]:/.test(normalized);

  if (isWindows) {
    const drive = normalized.slice(0, 2).toUpperCase(); // e.g. "C:"
    const rest = normalized.slice(2); // e.g. "/Users/waldemar/repo"
    const parts = rest.split("/").filter(Boolean);
    const sep = fullPath.includes("\\") ? "\\" : "/";

    const segments = [{ name: drive, path: `${drive}${sep}` }];
    let accumulated = `${drive}`;

    for (const part of parts) {
      accumulated += `${sep}${part}`;
      segments.push({ name: part, path: accumulated });
    }
    return segments;
  }

  // POSIX
  const parts = normalized.split("/").filter(Boolean);
  const segments = [{ name: "/", path: "/" }];
  let accumulated = "";
  for (const part of parts) {
    accumulated += `/${part}`;
    segments.push({ name: part, path: accumulated });
  }
  return segments;
}

export function DirectoryPickerModal({
  opened,
  onClose,
  initialPath,
  onSelectDirectory,
}: DirectoryPickerModalProps): React.ReactNode {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [searchFilter, setSearchFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualInput, setManualInput] = useState("");

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Initialize path when opened
  useEffect(() => {
    if (opened) {
      const starting = initialPath || "";
      setCurrentPath(starting);
      setSelectedPath(starting);
      setSearchFilter("");
      setManualMode(false);
      setManualInput(starting);
    }
  }, [opened, initialPath]);

  const browseQuery = useBrowseDirectory(
    { query: { path: currentPath || undefined, showHidden } },
    { enabled: opened },
  );

  const data = browseQuery.data;

  // Sync currentPath and manual input when directory data arrives
  useEffect(() => {
    if (data?.current && data.current !== currentPath) {
      setCurrentPath(data.current);
      setManualInput(data.current);
      if (!selectedPath) {
        setSelectedPath(data.current);
      }
    }
  }, [data?.current, currentPath, selectedPath]);

  const segments = useMemo(() => pathSegments(data?.current || currentPath || "/"), [data?.current, currentPath]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) {
      return [];
    }
    if (!searchFilter.trim()) {
      return data.entries;
    }
    const q = searchFilter.toLowerCase();
    return data.entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [data?.entries, searchFilter]);

  const handleNavigate = useCallback((targetPath: string) => {
    setCurrentPath(targetPath);
    setSelectedPath(targetPath);
    setSearchFilter("");
    setManualMode(false);
    setManualInput(targetPath);
  }, []);

  const handleSelectAndConfirm = useCallback(() => {
    const chosen = selectedPath || data?.current || currentPath;
    if (chosen) {
      onSelectDirectory(chosen);
      onClose();
    }
  }, [selectedPath, data?.current, currentPath, onSelectDirectory, onClose]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualInput.trim()) {
      handleNavigate(manualInput.trim());
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon size="md" radius="sm" variant="light" color="cyan">
            <IconFolder size={18} />
          </ThemeIcon>
          <Box>
            <Text size="sm" fw={700}>
              Open Directory
            </Text>
            <Text size="xs" c="dimmed">
              Select or browse a workspace directory on the server
            </Text>
          </Box>
        </Group>
      }
      size="lg"
      padding="md"
      radius="md"
    >
      <Stack gap="sm">
        {/* Navigation & Breadcrumb Toolbar */}
        <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: "var(--mantine-color-dark-8)" }}>
          <Group justify="space-between" align="center" wrap="nowrap">
            {/* Action buttons: Up, Home, Workspace */}
            <Group gap={4} wrap="nowrap">
              <Tooltip label="Up one level (parent directory)">
                <ActionIcon
                  size="sm"
                  variant="light"
                  color="gray"
                  disabled={!data?.parent}
                  onClick={() => data?.parent && handleNavigate(data.parent)}
                  aria-label="Parent directory"
                >
                  <IconCornerLeftUp size={14} />
                </ActionIcon>
              </Tooltip>

              {data?.home ? (
                <Tooltip label={`Home directory (${data.home})`}>
                  <ActionIcon
                    size="sm"
                    variant="light"
                    color="gray"
                    onClick={() => handleNavigate(data.home)}
                    aria-label="Home directory"
                  >
                    <IconHome size={14} />
                  </ActionIcon>
                </Tooltip>
              ) : null}

              {initialPath && initialPath !== data?.current ? (
                <Tooltip label={`Current session directory (${initialPath})`}>
                  <ActionIcon
                    size="sm"
                    variant="light"
                    color="cyan"
                    onClick={() => handleNavigate(initialPath)}
                    aria-label="Current workspace"
                  >
                    <IconFolder size={14} />
                  </ActionIcon>
                </Tooltip>
              ) : null}

              <Tooltip label={showHidden ? "Hide hidden folders (dotfiles)" : "Show hidden folders (dotfiles)"}>
                <ActionIcon
                  size="sm"
                  variant={showHidden ? "filled" : "light"}
                  color={showHidden ? "cyan" : "gray"}
                  onClick={() => setShowHidden((v) => !v)}
                  aria-label="Toggle hidden folders"
                >
                  {showHidden ? <IconEye size={14} /> : <IconEyeOff size={14} />}
                </ActionIcon>
              </Tooltip>
            </Group>

            {/* Path mode toggle */}
            <Tooltip label={manualMode ? "Back to breadcrumb navigation" : "Edit path as text"}>
              <ActionIcon
                size="sm"
                variant={manualMode ? "filled" : "subtle"}
                color="gray"
                onClick={() => {
                  setManualMode((v) => !v);
                  if (!manualMode) {
                    setManualInput(data?.current || currentPath);
                  }
                }}
                aria-label="Edit path"
              >
                <IconEdit size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>

          {/* Breadcrumbs or Manual Input Bar */}
          <Box pt="xs">
            {manualMode ? (
              <form onSubmit={handleManualSubmit}>
                <Group gap="xs" wrap="nowrap">
                  <TextInput
                    size="xs"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.currentTarget.value)}
                    placeholder="/path/to/directory"
                    style={{ flex: 1 }}
                    autoFocus
                  />
                  <Button size="xs" color="cyan" type="submit">
                    Go
                  </Button>
                </Group>
              </form>
            ) : (
              <ScrollArea type="never">
                <Group gap={4} wrap="nowrap" align="center" style={{ minHeight: 28 }}>
                  {segments.map((seg, idx) => {
                    const isLast = idx === segments.length - 1;
                    return (
                      <React.Fragment key={seg.path}>
                        <UnstyledButton
                          onClick={() => handleNavigate(seg.path)}
                          style={{
                            padding: "2px 6px",
                            borderRadius: "var(--mantine-radius-xs)",
                            backgroundColor: isLast ? "var(--mantine-color-cyan-light)" : "rgba(255, 255, 255, 0.05)",
                            color: isLast ? "var(--mantine-color-cyan-3)" : "inherit",
                            fontWeight: isLast ? 700 : 500,
                            fontSize: "12px",
                            cursor: "pointer",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {seg.name}
                        </UnstyledButton>
                        {!isLast ? (
                          <IconChevronRight size={12} color="var(--mantine-color-dimmed)" style={{ flexShrink: 0 }} />
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                  {data?.isGit ? (
                    <Badge
                      size="xs"
                      variant="outline"
                      color="teal"
                      leftSection={<IconGitBranch size={10} />}
                      style={{ flexShrink: 0, marginLeft: 4 }}
                    >
                      {data.gitBranch || "git"}
                    </Badge>
                  ) : null}
                </Group>
              </ScrollArea>
            )}
          </Box>
        </Paper>

        {/* Search filter within directory */}
        <TextInput
          size="xs"
          placeholder="Filter subdirectories..."
          leftSection={<IconSearch size={14} />}
          value={searchFilter}
          ref={searchInputRef}
          onChange={(e) => setSearchFilter(e.currentTarget.value)}
          rightSection={
            searchFilter ? (
              <ActionIcon size="xs" variant="subtle" onClick={() => setSearchFilter("")}>
                <IconX size={12} />
              </ActionIcon>
            ) : null
          }
        />

        {/* Subdirectories Listing */}
        <Paper
          withBorder
          radius="sm"
          style={{
            minHeight: 220,
            maxHeight: 320,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ScrollArea style={{ flex: 1 }} p="xs">
            {browseQuery.isPending ? (
              <Center py={40}>
                <Group gap="xs">
                  <Loader size="sm" color="cyan" />
                  <Text size="xs" c="dimmed">
                    Reading directory...
                  </Text>
                </Group>
              </Center>
            ) : data?.error ? (
              <Center py={30}>
                <Stack align="center" gap="xs">
                  <IconAlertTriangle size={24} color="var(--mantine-color-red-4)" />
                  <Text size="xs" c="red.4" ta="center">
                    {data.error}
                  </Text>
                </Stack>
              </Center>
            ) : filteredEntries.length === 0 ? (
              <Center py={40}>
                <Stack align="center" gap={4}>
                  <IconFolder size={28} color="var(--mantine-color-dimmed)" />
                  <Text size="xs" c="dimmed">
                    {searchFilter ? "No matching subdirectories." : "No subdirectories in this folder."}
                  </Text>
                </Stack>
              </Center>
            ) : (
              <Stack gap={2}>
                {filteredEntries.map((entry) => {
                  const isSelected = selectedPath === entry.path;

                  return (
                    <Group
                      key={entry.path}
                      justify="space-between"
                      align="center"
                      wrap="nowrap"
                      p="xs"
                      onClick={() => setSelectedPath(entry.path)}
                      onDoubleClick={() => handleNavigate(entry.path)}
                      style={{
                        borderRadius: "var(--mantine-radius-xs)",
                        backgroundColor: isSelected ? "var(--mantine-color-cyan-light)" : "transparent",
                        border: isSelected ? "1px solid var(--mantine-color-cyan-outline)" : "1px solid transparent",
                        cursor: "pointer",
                        userSelect: "none",
                        transition: "background-color 100ms ease",
                      }}
                    >
                      <Group gap="xs" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                        <IconFolder
                          size={16}
                          color={
                            entry.isGit
                              ? "var(--mantine-color-teal-4)"
                              : isSelected
                                ? "var(--mantine-color-cyan-4)"
                                : "var(--mantine-color-dimmed)"
                          }
                          style={{ flexShrink: 0 }}
                        />
                        <Text
                          size="xs"
                          fw={isSelected ? 600 : 400}
                          c={isSelected ? "cyan.3" : undefined}
                          truncate
                          title={entry.name}
                        >
                          {entry.name}
                        </Text>
                        {entry.isGit ? (
                          <Badge size="xs" variant="dot" color="teal" style={{ flexShrink: 0 }}>
                            git
                          </Badge>
                        ) : null}
                      </Group>

                      <Group gap={4} wrap="nowrap">
                        <Tooltip label="Open subdirectory" position="left">
                          <ActionIcon
                            size="xs"
                            variant="subtle"
                            color="gray"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNavigate(entry.path);
                            }}
                            aria-label={`Enter ${entry.name}`}
                          >
                            <IconChevronRight size={14} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Group>
                  );
                })}
              </Stack>
            )}
          </ScrollArea>
        </Paper>

        {/* Selected target path & actions */}
        <Group justify="space-between" align="center" pt="xs" style={{ borderTop: "1px solid var(--omega-line)" }}>
          <Box style={{ flex: 1, minWidth: 0 }}>
            <Text size="xs" c="dimmed">
              Target Directory:
            </Text>
            <Text size="xs" fw={600} truncate title={selectedPath || data?.current || currentPath}>
              {selectedPath || data?.current || currentPath || "—"}
            </Text>
          </Box>

          <Group gap="xs" wrap="nowrap">
            <Button size="xs" variant="subtle" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="xs"
              color="cyan"
              variant="filled"
              leftSection={<IconFolderCheck size={14} />}
              onClick={handleSelectAndConfirm}
              disabled={!(selectedPath || data?.current || currentPath)}
            >
              Open Directory
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
