import { ActionIcon, Badge, Box, Group, Paper, Stack, Text, ThemeIcon, Tooltip } from "@mantine/core";
import { IconMinus, IconPlus, IconRefresh, IconSparkles, IconZoomIn, IconZoomOut } from "@tabler/icons-react";
import * as d3 from "d3";
import React, { useCallback, useMemo, useRef, useState } from "react";

/** Data node structure for the MindMap. */
export interface MindMapNodeData {
  /** Unique node identifier. */
  id?: string;
  /** Display label for the node. */
  name: string;
  /** Nested sub-topics and ideas. */
  children?: MindMapNodeData[];
  /** Optional color override (e.g. "cyan", "blue", "teal", "orange", "plum", "red", "yellow"). */
  color?: string;
  /** Optional secondary subtitle or description. */
  description?: string;
  /** Optional icon or emoji prefix. */
  icon?: string;
  /** Optional tag badge text. */
  badge?: string;
}

export interface MindMapProps {
  /** Root node hierarchy data. */
  data: MindMapNodeData;
  /** Container viewport width (default 800). */
  width?: number | string;
  /** Container viewport height (default 500). */
  height?: number | string;
  /** Optional node selection / action callback. */
  onNodeClick?: (node: MindMapNodeData) => void;
  /** Optional custom title in header. */
  title?: string;
}

/** Distinct branch colors for top-level subtrees. */
const BRANCH_COLORS = [
  "#388bfd", // Blue
  "#39c5cf", // Cyan
  "#bc8cff", // Plum / Purple
  "#2ea043", // Green
  "#f0883e", // Orange
  "#ff7b72", // Coral
  "#d29922", // Gold
  "#56d364", // Lime
];

interface PositionedNode {
  data: MindMapNodeData;
  depth: number;
  x: number; // computed canvas X
  y: number; // computed canvas Y
  isLeft: boolean;
  isRoot: boolean;
  color: string;
  hasChildren: boolean;
  isCollapsed: boolean;
  childCount: number;
  parent?: PositionedNode;
}

interface PositionedLink {
  source: PositionedNode;
  target: PositionedNode;
  color: string;
}

export const MindMap: React.FC<MindMapProps> = ({ data, width = 800, height = 500, onNodeClick, title }) => {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const numWidth = typeof width === "number" ? width : 800;
  const numHeight = typeof height === "number" ? height : 500;

  const toggleCollapse = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Filter out collapsed descendants from the hierarchy
  const filteredData = useMemo(() => {
    function filterNode(node: MindMapNodeData, path: string): MindMapNodeData {
      const id = node.id || path;
      const isCollapsed = collapsedIds.has(id);
      if (isCollapsed || !node.children || node.children.length === 0) {
        return { ...node, id, children: undefined };
      }
      return {
        ...node,
        id,
        children: node.children.map((child, i) => filterNode(child, `${path}/${i}`)),
      };
    }
    return filterNode(data, "root");
  }, [data, collapsedIds]);

  // Compute D3 Tree positions radiating horizontally (left and right) from root
  const { nodes, links } = useMemo(() => {
    if (!filteredData) {
      return {
        nodes: [],
        links: [],
      };
    }

    const rootHierarchy = d3.hierarchy<MindMapNodeData>(filteredData);
    const rootChildren = rootHierarchy.children ?? [];

    const nodesList: PositionedNode[] = [];
    const linksList: PositionedLink[] = [];

    // Root node in dead center
    const centerX = numWidth / 2;
    const centerY = numHeight / 2;

    const rootNode: PositionedNode = {
      data: filteredData,
      depth: 0,
      x: centerX,
      y: centerY,
      isLeft: false,
      isRoot: true,
      color: filteredData.color || "var(--mantine-color-blue-filled)",
      hasChildren: Boolean(data.children && data.children.length > 0),
      isCollapsed: collapsedIds.has(filteredData.id || "root"),
      childCount: data.children?.length ?? 0,
    };
    nodesList.push(rootNode);

    if (rootChildren.length > 0) {
      // Split top-level branches into right and left halves
      const rightChildren = rootChildren.slice(0, Math.ceil(rootChildren.length / 2));
      const leftChildren = rootChildren.slice(Math.ceil(rootChildren.length / 2));

      const layoutSide = (
        branches: d3.HierarchyNode<MindMapNodeData>[],
        isLeft: boolean,
        baseColorIdx: number,
      ) => {
        if (branches.length === 0) return;

        // Create a virtual subtree for this side
        const virtualRootData: MindMapNodeData = {
          id: isLeft ? "__virtual_left__" : "__virtual_right__",
          name: "",
          children: branches.map(b => b.data),
        };
        const virtualHierarchy = d3.hierarchy<MindMapNodeData>(virtualRootData);

        // Vertical spacing per leaf node: ~60px, horizontal spacing: ~180px
        const leafCount = virtualHierarchy.leaves().length;
        const sideHeight = Math.max(numHeight - 120, leafCount * 55);
        const sideWidth = Math.max(numWidth / 2 - 140, 220);

        const treeLayout = d3
          .tree<MindMapNodeData>()
          .size([sideHeight, sideWidth])
          .separation((a, b) => (a.parent === b.parent ? 1 : 1.25));

        const pointRoot = treeLayout(virtualHierarchy) as d3.HierarchyPointNode<MindMapNodeData>;

        const sideDescendants = pointRoot.descendants().filter(d => d.depth > 0);
        const nodeMap = new Map<MindMapNodeData, PositionedNode>();
        nodeMap.set(virtualRootData, rootNode);

        // Determine branch color for each node based on top ancestor
        sideDescendants.forEach(d => {
          let topBranchIdx = 0;
          let ancestor: d3.HierarchyPointNode<MindMapNodeData> = d;
          while (ancestor.depth > 1 && ancestor.parent) {
            ancestor = ancestor.parent;
          }
          if (ancestor.parent) {
            topBranchIdx = (ancestor.parent.children ?? []).indexOf(ancestor);
          }
          const color =
            d.data.color || BRANCH_COLORS[(baseColorIdx + topBranchIdx) % BRANCH_COLORS.length] || "#388bfd";

          const pointY = d.y ?? 0;
          const pointX = d.x ?? 0;

          // pointX is vertical coordinate, pointY is horizontal distance from virtual root
          const computedX = isLeft ? centerX - (pointY + 40) : centerX + (pointY + 40);
          const computedY = centerY + (pointX - sideHeight / 2);
          // Find original data to check actual child count
          function findOriginal(curr: MindMapNodeData): MindMapNodeData | undefined {
            if (curr.id === d.data.id || curr.name === d.data.name) return curr;
            if (curr.children) {
              for (const child of curr.children) {
                const found = findOriginal(child);
                if (found) return found;
              }
            }
            return undefined;
          }
          const originalNode = findOriginal(data);
          const hasOriginalChildren = Boolean(originalNode?.children && originalNode.children.length > 0);
          const isNodeCollapsed = collapsedIds.has(d.data.id || "");

          const positioned: PositionedNode = {
            data: d.data,
            depth: d.depth,
            x: computedX,
            y: computedY,
            isLeft,
            isRoot: false,
            color,
            hasChildren: hasOriginalChildren,
            isCollapsed: isNodeCollapsed,
            childCount: originalNode?.children?.length ?? 0,
          };

          nodeMap.set(d.data, positioned);
          nodesList.push(positioned);
        });

        // Generate links for this side
        virtualHierarchy.links().forEach(link => {
          const srcNode = nodeMap.get(link.source.data);
          const tgtNode = nodeMap.get(link.target.data);
          if (srcNode && tgtNode) {
            tgtNode.parent = srcNode;
            linksList.push({
              source: srcNode,
              target: tgtNode,
              color: tgtNode.color || "#388bfd",
            });
          }
        });
      };

      layoutSide(rightChildren, false, 0);
      layoutSide(leftChildren, true, rightChildren.length);
    }

    return {
      nodes: nodesList,
      links: linksList,
    };
  }, [filteredData, data, collapsedIds, numWidth, numHeight]);

  // Smooth horizontal Bezier curve generator
  const linkPathGenerator = useCallback((link: PositionedLink) => {
    const sourceX = link.source.x;
    const sourceY = link.source.y;
    const targetX = link.target.x;
    const targetY = link.target.y;

    return (
      d3.linkHorizontal()({
        source: [sourceX, sourceY],
        target: [targetX, targetY],
      } as any) || undefined
    );
  }, []);

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
    setZoomLevel(z => Math.min(z + 0.15, 2.5));
  };

  const handleZoomOut = () => {
    setZoomLevel(z => Math.max(z - 0.15, 0.4));
  };

  return (
    <Box
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
      className="omega-mindmap-container"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Controls Toolbar */}
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
            <IconSparkles size={12} />
          </ThemeIcon>
          <Text size="xs" fw={700} c="dimmed">
            {title || data.name || "Mind Map"}
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
          {collapsedIds.size > 0 ? (
            <Badge
              size="xs"
              variant="light"
              color="orange"
              style={{ cursor: "pointer" }}
              onClick={() => setCollapsedIds(new Set())}
            >
              Expand All ({collapsedIds.size})
            </Badge>
          ) : null}
        </Group>
      </Group>

      {/* Transformable Canvas Layer */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: numWidth,
          height: numHeight,
          transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
          transformOrigin: `${numWidth / 2}px ${numHeight / 2}px`,
          transition: isDragging ? "none" : "transform 0.15s ease-out",
          cursor: isDragging ? "grabbing" : "grab",
        }}
      >
        {/* Layer 1: SVG Canvas for smooth connecting links */}
        <svg
          width={numWidth}
          height={numHeight}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            overflow: "visible",
            pointerEvents: "none",
          }}
        >
          <g fill="none">
            {links.map((link, idx) => (
              <path
                key={idx}
                d={linkPathGenerator(link)}
                stroke={link.color}
                strokeWidth={link.target.depth === 1 ? 2.5 : 1.75}
                strokeOpacity={0.65}
                strokeLinecap="round"
              />
            ))}
          </g>
        </svg>

        {/* Layer 2: Interactive HTML Node Components */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: numWidth,
            height: numHeight,
            pointerEvents: "none",
          }}
        >
          {nodes.map(node => {
            const isRoot = node.isRoot;
            const nodeId = node.data.id || node.data.name;

            return (
              <div
                key={nodeId}
                style={{
                  position: "absolute",
                  left: node.x,
                  top: node.y,
                  transform: "translate(-50%, -50%)",
                  pointerEvents: "auto",
                  zIndex: 20 - node.depth,
                }}
              >
                <Paper
                  shadow={isRoot ? "md" : "xs"}
                  px={isRoot ? "md" : "xs"}
                  py={isRoot ? 8 : 4}
                  withBorder
                  radius={isRoot ? "lg" : "md"}
                  style={{
                    borderColor: isRoot ? node.color : `${node.color}55`,
                    backgroundColor: isRoot ? "var(--mantine-color-body)" : "var(--mantine-color-default)",
                    boxShadow: isRoot ? `0 0 12px ${node.color}33` : `0 2px 6px rgba(0, 0, 0, 0.15)`,
                    cursor: onNodeClick ? "pointer" : "default",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease",
                  }}
                  onClick={() => onNodeClick?.(node.data)}
                >
                  <Group gap={6} wrap="nowrap">
                    {node.data.icon ? (
                      <Text size="xs" style={{ flexShrink: 0 }}>
                        {node.data.icon}
                      </Text>
                    ) : null}

                    <Stack gap={0}>
                      <Text
                        size={isRoot ? "sm" : "xs"}
                        fw={isRoot ? 700 : node.depth === 1 ? 600 : 500}
                        c={isRoot ? undefined : "dimmed"}
                        style={{
                          whiteSpace: "nowrap",
                          color: isRoot ? "var(--mantine-color-text)" : undefined,
                        }}
                      >
                        {node.data.name}
                      </Text>

                      {node.data.description ? (
                        <Text size="0.65rem" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                          {node.data.description}
                        </Text>
                      ) : null}
                    </Stack>

                    {node.data.badge ? (
                      <Badge size="xs" variant="light" color="cyan">
                        {node.data.badge}
                      </Badge>
                    ) : null}

                    {/* Expand/Collapse Toggle Button for Nodes with Children */}
                    {node.hasChildren && !isRoot ? (
                      <ActionIcon
                        size={16}
                        radius="xl"
                        variant={node.isCollapsed ? "filled" : "subtle"}
                        color="slate"
                        style={{
                          backgroundColor: node.isCollapsed ? node.color : undefined,
                          color: node.isCollapsed ? "#fff" : undefined,
                          marginLeft: 2,
                        }}
                        onClick={e => toggleCollapse(nodeId, e)}
                        aria-label={node.isCollapsed ? "Expand branch" : "Collapse branch"}
                      >
                        {node.isCollapsed ? (
                          <IconPlus size={10} stroke={2.5} />
                        ) : (
                          <IconMinus size={10} stroke={2.5} />
                        )}
                      </ActionIcon>
                    ) : null}
                  </Group>
                </Paper>
              </div>
            );
          })}
        </div>
      </div>
    </Box>
  );
};
