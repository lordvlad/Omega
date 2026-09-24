import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Drawer, type DrawerProps } from "@mantine/core";

export interface ResizableDrawerProps extends DrawerProps {
  /** Optional minimum size in pixels (default 280 for horizontal, 180 for vertical). */
  minSize?: number;
  /** Optional maximum size in pixels (default viewport - 20). */
  maxSize?: number;
  /** Optional localStorage key to remember the user's resized width/height. */
  storageKey?: string;
  /** Explicitly toggle resizing (defaults to true for all drawers). */
  resizable?: boolean;
}

/**
 * Enhanced Mantine Drawer with a smooth drag-to-resize handle on its leading edge.
 *
 * For right-anchored drawers, dragging the left border expands/contracts the width.
 * For left-anchored drawers, dragging the right border adjusts width.
 * For bottom-anchored drawers, dragging the top border adjusts height.
 * Double-clicking the resize handle resets to the default size.
 */
export function ResizableDrawer({
  size = "md",
  position = "right",
  minSize,
  maxSize,
  storageKey,
  resizable = true,
  opened,
  children,
  styles,
  className,
  ...rest
}: ResizableDrawerProps) {
  const [customSize, setCustomSize] = useState<number | null>(() => {
    if (storageKey && typeof window !== "undefined") {
      try {
        const saved = window.localStorage.getItem(`omega:drawer-size:${storageKey}`);
        if (saved) {
          const num = Number(saved);
          if (!Number.isNaN(num) && num >= 150) {
            return num;
          }
        }
      } catch {}
    }
    return null;
  });

  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isVertical = position === "bottom" || position === "top";
  const effectiveMin = minSize ?? (isVertical ? 180 : 280);
  const effectiveMax =
    maxSize ?? (typeof window !== "undefined" ? (isVertical ? window.innerHeight - 30 : window.innerWidth - 30) : 1600);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      isDraggingRef.current = true;
      setIsDragging(true);

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}

      const startCursor = isVertical ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.cursor = startCursor;

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (!isDraggingRef.current) {
          return;
        }

        let calculated = 0;
        if (position === "right") {
          calculated = window.innerWidth - moveEvent.clientX;
        } else if (position === "left") {
          calculated = moveEvent.clientX;
        } else if (position === "bottom") {
          calculated = window.innerHeight - moveEvent.clientY;
        } else if (position === "top") {
          calculated = moveEvent.clientY;
        }

        const clamped = Math.min(Math.max(calculated, effectiveMin), effectiveMax);
        setCustomSize(clamped);

        if (storageKey && typeof window !== "undefined") {
          try {
            window.localStorage.setItem(`omega:drawer-size:${storageKey}`, String(clamped));
          } catch {}
        }
      };

      const onPointerUp = (upEvent: PointerEvent) => {
        isDraggingRef.current = false;
        setIsDragging(false);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        try {
          if (e.currentTarget?.hasPointerCapture(upEvent.pointerId)) {
            e.currentTarget.releasePointerCapture(upEvent.pointerId);
          }
        } catch {}
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [position, isVertical, effectiveMin, effectiveMax, resizable, storageKey],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setCustomSize(null);
      if (storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(`omega:drawer-size:${storageKey}`);
        } catch {}
      }
    },
    [storageKey],
  );

  // Clean up global styles if unmounted while dragging
  useEffect(() => {
    return () => {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  const activeSize = customSize !== null ? customSize : size;

  // Build the resize handle styling based on drawer position
  const handleStyle: React.CSSProperties = useMemo(() => {
    const isRight = position === "right";
    const isLeft = position === "left";
    const isBottom = position === "bottom";

    return {
      position: "absolute",
      zIndex: 1000,
      touchAction: "none",
      transition: "background-color 0.15s ease, opacity 0.15s ease",
      backgroundColor: isDragging || isHovered ? "var(--mantine-color-cyan-6)" : "transparent",
      opacity: isDragging || isHovered ? 0.9 : 0,
      ...(isRight
        ? {
            left: 0,
            top: 0,
            bottom: 0,
            width: 10,
            cursor: "col-resize",
            transform: "translateX(-5px)",
            borderLeft: "2px solid var(--mantine-color-cyan-5)",
          }
        : isLeft
          ? {
              right: 0,
              top: 0,
              bottom: 0,
              width: 10,
              cursor: "col-resize",
              transform: "translateX(5px)",
              borderRight: "2px solid var(--mantine-color-cyan-5)",
            }
          : isBottom
            ? {
                top: 0,
                left: 0,
                right: 0,
                height: 10,
                cursor: "row-resize",
                transform: "translateY(-5px)",
                borderTop: "2px solid var(--mantine-color-cyan-5)",
              }
            : {
                bottom: 0,
                left: 0,
                right: 0,
                height: 10,
                cursor: "row-resize",
                transform: "translateY(5px)",
                borderBottom: "2px solid var(--mantine-color-cyan-5)",
              }),
    };
  }, [position, isDragging, isHovered]);

  return (
    <Drawer opened={opened} position={position} size={activeSize} className={className} styles={styles} {...rest}>
      {resizable && opened ? (
        <div
          style={handleStyle}
          onPointerDown={handlePointerDown}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onDoubleClick={handleDoubleClick}
          title={
            isVertical
              ? "Drag vertically to resize drawer (double-click to reset)"
              : "Drag horizontally to resize drawer (double-click to reset)"
          }
          aria-label="Resize drawer"
          role="separator"
          aria-orientation={isVertical ? "horizontal" : "vertical"}
        />
      ) : null}
      {children}
    </Drawer>
  );
}
