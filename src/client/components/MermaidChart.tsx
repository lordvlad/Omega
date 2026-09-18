import {
  ActionIcon,
  Alert,
  Box,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertCircle,
  IconCheck,
  IconCopy,
  IconRefresh,
  IconSchema,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import mermaid from "mermaid";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";

import { copyText } from "../lib/clipboard.ts";

export interface MermaidChartProps {
  /** The Mermaid diagram definition code (e.g. `graph TD; A-->B;`). */
  chart?: string;
  /** Alias for `chart`. */
  code?: string;
  /** Optional diagram title displayed in the toolbar. */
  title?: string;
  /** Container width (default "100%"). */
  width?: number | string;
  /** Container height (default 400). */
  height?: number | string;
  /** Mermaid theme preset (default "dark"). */
  theme?: "dark" | "default" | "forest" | "neutral" | "base";
  /** Optional callback when a diagram node is clicked. */
  onNodeClick?: (nodeId: string) => void;
}

// Configure mermaid with dark theme defaults suitable for Omega
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "loose",
  theme: "dark",
  themeVariables: {
    darkMode: true,
    background: "#0d1117",
    primaryColor: "#388bfd",
    primaryTextColor: "#f0f6fc",
    primaryBorderColor: "#1f6feb",
    lineColor: "#58a6ff",
    secondaryColor: "#bc8cff",
    tertiaryColor: "#161b22",
    fontFamily: "var(--mantine-font-family)",
    fontSize: "13px",
  },
  fontFamily: "var(--mantine-font-family)",
});

export const MermaidChart: React.FC<MermaidChartProps> = ({
  chart,
  code,
  title,
  width = "100%",
  height = 400,
  theme = "dark",
  onNodeClick,
}) => {
  const rawCode = (chart ?? code ?? "").trim();
  const rawId = useId();
  const diagramId = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const [svgHtml, setSvgHtml] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rawCode) {
      setSvgHtml("");
      setError(null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    async function renderDiagram() {
      try {
        // Re-initialize theme if custom theme specified
        if (theme !== "dark") {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "loose",
            theme,
          });
        }

        const renderId = `${diagramId}-${Date.now()}`;
        const { svg } = await mermaid.render(renderId, rawCode);

        if (isMounted) {
          setSvgHtml(svg);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Mermaid rendering failed:", err);
          setError(err instanceof Error ? err.message : "Failed to parse and render Mermaid diagram.");
          setLoading(false);
        }
      }
    }

    void renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [rawCode, diagramId, theme]);

  const handleCopyCode = useCallback(async () => {
    if (!rawCode) return;
    const ok = await copyText(rawCode);
    if (ok) {
      setCopied(true);
      notifications.show({
        message: "Mermaid source code copied to clipboard",
        color: "cyan",
        autoClose: 2000,
      });
      setTimeout(() => setCopied(false), 2000);
    }
  }, [rawCode]);

  // Drag-to-pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPanOffset({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleReset = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleZoomIn = () => {
    setZoomLevel(z => Math.min(z + 0.2, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel(z => Math.max(z - 0.2, 0.3));
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (!onNodeClick) return;
    const target = (e.target as HTMLElement).closest(".node, .actor, .classGroup, g[id*='node'], .cluster");
    if (target) {
      const id = target.id || target.getAttribute("data-id") || target.textContent?.trim() || "";
      if (id) {
        onNodeClick(id);
      }
    }
  };

  return (
    <Box
      ref={containerRef}
      style={{
        position: "relative",
        width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height,
        overflow: "hidden",
        borderRadius: "var(--mantine-radius-md)",
        border: "1px solid var(--mantine-color-default-border)",
        background: "var(--mantine-color-body)",
        userSelect: "none",
      }}
      className="omega-mermaid-container"
      onClick={handleContainerClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Toolbar */}
      <Group
        justify="space-between"
        align="center"
        px="sm"
        py={6}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          background: "rgba(var(--mantine-color-body-rgb, 15, 17, 23), 0.75)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid var(--mantine-color-default-border)",
        }}
      >
        <Group gap={6}>
          <ThemeIcon size="xs" variant="light" color="cyan" radius="xl">
            <IconSchema size={12} />
          </ThemeIcon>
          <Text size="xs" fw={700} c="dimmed">
            {title || "Mermaid Diagram"}
          </Text>
        </Group>

        <Group gap={4}>
          <Tooltip label="Zoom In">
            <ActionIcon size="xs" variant="subtle" color="slate" onClick={handleZoomIn} aria-label="Zoom In">
              <IconZoomIn size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Zoom Out">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="slate"
              onClick={handleZoomOut}
              aria-label="Zoom Out"
            >
              <IconZoomOut size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label="Reset View">
            <ActionIcon
              size="xs"
              variant="subtle"
              color="slate"
              onClick={handleReset}
              aria-label="Reset View"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip label={copied ? "Copied source" : "Copy Mermaid code"}>
            <ActionIcon
              size="xs"
              variant="subtle"
              color={copied ? "cyan" : "slate"}
              onClick={handleCopyCode}
              aria-label="Copy Mermaid code"
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {/* Main Canvas Area */}
      {loading ? (
        <Center h="100%">
          <Stack align="center" gap="xs">
            <Loader size="sm" color="cyan" />
            <Text size="xs" c="dimmed">
              Rendering diagram...
            </Text>
          </Stack>
        </Center>
      ) : error ? (
        <Center h="100%" p="md">
          <Alert
            icon={<IconAlertCircle size={16} />}
            title="Mermaid Syntax Error"
            color="red"
            variant="light"
            style={{ maxWidth: 500 }}
          >
            <Text size="xs">{error}</Text>
          </Alert>
        </Center>
      ) : !rawCode ? (
        <Center h="100%">
          <Text size="xs" c="dimmed">
            No Mermaid code provided
          </Text>
        </Center>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 0.15s ease-out",
            cursor: isDragging ? "grabbing" : "grab",
          }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      )}
    </Box>
  );
};

// Also export as Mermaid alias
export { MermaidChart as Mermaid };
