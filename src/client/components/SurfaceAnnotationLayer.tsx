import React, { useCallback, useEffect, useRef, useState } from "react";
import { IconNote, IconTrash } from "@tabler/icons-react";
/**
 * The annotation layer over one A2UI surface: a red marker and sticky notes.
 *
 * It wraps the renderer rather than reaching into it. `A2UIRenderer` is a
 * single large component switch over the whole catalog, and marking up what it
 * drew needs nothing from inside it — a pointer position over the rendered
 * result is enough, and the text under that position is read back out of the
 * DOM, so no component has to cooperate.
 *
 * Every coordinate is normalized to 0..1 against the surface box. The agent
 * redraws surfaces as it works, and `recreateSurface` tears one down and
 * rebuilds it, so a mark pinned to pixels would end up somewhere else.
 */
import { Box, Button, Group, Modal, Textarea, Tooltip } from "@mantine/core";
import type { Annotation, AnnotationStroke } from "../lib/annotations.ts";

export interface SurfaceAnnotationLayerProps {
  surfaceId: string;
  /** Every annotation in the store; the layer picks out its own surface. */
  annotations: Annotation[];
  /** The red marker is armed: strokes are captured on this surface. */
  penArmed: boolean;
  /** An unplaced sticky note waits in the corner to be dragged into place. */
  noteArmed: boolean;
  onCommitDrawing: (strokes: AnnotationStroke[], targets: string[]) => void;
  onPlaceNote: (x: number, y: number, target: string | undefined) => void;
  /** A placed note was dragged somewhere else. */
  onMoveNote: (id: string, x: number, y: number) => void;
  onUpdateNote: (id: string, note: string) => void;
  onDeleteAnnotation: (id: string) => void;
  /** The sticky note was placed or abandoned; the host clears `noteArmed`. */
  onDisarmNote: () => void;
  /** Open this note's editor, which the host sets right after a drop. */
  editingNoteId?: string | null;
  /** The editor closed. */
  onEditingDone?: () => void;
  children: React.ReactNode;
}

/** Marker colour: a red pen over a dark surface, hard to mistake for content. */
const MARKER = "#ff4d4f";

/** Strokes closer together than this add nothing but bytes. */
const MIN_STEP = 0.004;

/** How long a finished stroke waits for a next one before it is committed. */
const STROKE_IDLE_MS = 1200;

/** Most labels recorded per drawing; past this the list stops being a hint. */
const MAX_TARGETS = 6;

/** Longest text taken as a label, past which it is prose, not a name. */
const MAX_LABEL = 80;

/** A drag of less than this many pixels is a click, not a move. */
const DRAG_SLOP = 4;

/**
 * The name of whatever is under a point, read out of the rendered surface.
 *
 * `elementsFromPoint` rather than `elementFromPoint`, because an armed pen
 * puts a transparent canvas over everything: the topmost hit is the overlay,
 * and walking up from it lands on the whole surface and reads back every
 * label at once. Skipping the overlay's own subtree leaves the deepest real
 * element — a node label, a cell, a heading — which is what a user means when
 * they circle something.
 */
function labelAt(clientX: number, clientY: number, host: HTMLElement, skip: Element | null): string | undefined {
  for (const hit of document.elementsFromPoint(clientX, clientY)) {
    if (!host.contains(hit)) {
      continue;
    }
    if (skip && (hit === skip || skip.contains(hit))) {
      continue;
    }
    const text = hit.textContent?.trim() ?? "";
    if (text.length > 0 && text.length <= MAX_LABEL) {
      return text;
    }
  }
  return undefined;
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function pointsAttribute(stroke: AnnotationStroke): string {
  return stroke.points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function SurfaceAnnotationLayer({
  surfaceId,
  annotations,
  penArmed,
  noteArmed,
  onCommitDrawing,
  onPlaceNote,
  onMoveNote,
  onUpdateNote,
  onDeleteAnnotation,
  onDisarmNote,
  editingNoteId,
  onEditingDone,
  children,
}: SurfaceAnnotationLayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  /** The stroke canvas, which must not be mistaken for surface content. */
  const overlayRef = useRef<SVGSVGElement>(null);

  /** Strokes finished but not yet committed, plus what they passed over. */
  const pendingRef = useRef<AnnotationStroke[]>([]);
  const targetsRef = useRef<Set<string>>(new Set());
  const idleRef = useRef<number | undefined>(undefined);
  /** The stroke being drawn right now, mirrored in state so it is visible. */
  const [liveStroke, setLiveStroke] = useState<AnnotationStroke | null>(null);
  const [liveStrokes, setLiveStrokes] = useState<AnnotationStroke[]>([]);

  /** Where the unplaced sticky note currently is, in client pixels. */
  const [dragGhost, setDragGhost] = useState<{ x: number; y: number } | null>(null);
  /** The pin being pressed, and whether the press has become a drag. */
  const dragNoteRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    captured: boolean;
  } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const mine = annotations.filter((entry) => entry.kind !== "file" && entry.surfaceId === surfaceId);
  const drawings = mine.filter((entry): entry is Extract<Annotation, { kind: "drawing" }> => entry.kind === "drawing");
  const notes = mine.filter((entry): entry is Extract<Annotation, { kind: "note" }> => entry.kind === "note");

  const normalize = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const host = hostRef.current;
    if (!host) {
      return null;
    }
    const rect = host.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: clamp01((clientX - rect.left) / rect.width),
      y: clamp01((clientY - rect.top) / rect.height),
    };
  }, []);

  /**
   * Hand the accumulated strokes over as one annotation.
   *
   * A scribble is several strokes, and a user who lifts the pen to cross a
   * second line has not made a second remark — so strokes group until the pen
   * goes idle, is put down, or the surface goes away. Idempotent, because all
   * three of those can happen in any order.
   */
  const flush = useCallback((): void => {
    if (idleRef.current !== undefined) {
      window.clearTimeout(idleRef.current);
      idleRef.current = undefined;
    }
    if (pendingRef.current.length === 0) {
      return;
    }
    const strokes = pendingRef.current;
    const targets = [...targetsRef.current];
    pendingRef.current = [];
    targetsRef.current = new Set();
    setLiveStrokes([]);
    onCommitDrawing(strokes, targets);
  }, [onCommitDrawing]);

  // Putting the pen down commits what it drew, as does the drawer closing.
  useEffect(() => {
    if (!penArmed) {
      flush();
    }
  }, [penArmed, flush]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  // The host opens the editor for a note the moment it is dropped, so a
  // placed note never needs a second gesture before it can say anything.
  useEffect(() => {
    if (!editingNoteId) {
      return;
    }
    const target = notes.find((entry) => entry.id === editingNoteId);
    if (!target) {
      return;
    }
    setEditing(editingNoteId);
    setDraft(target.note);
    onEditingDone?.();
  }, [editingNoteId, notes, onEditingDone]);

  const handlePenDown = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!penArmed) {
      return;
    }
    const point = normalize(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (idleRef.current !== undefined) {
      window.clearTimeout(idleRef.current);
      idleRef.current = undefined;
    }
    setLiveStroke({ points: [point] });
  };

  const handlePenMove = (event: React.PointerEvent<SVGSVGElement>): void => {
    if (!liveStroke) {
      return;
    }
    const point = normalize(event.clientX, event.clientY);
    if (!point) {
      return;
    }
    const last = liveStroke.points[liveStroke.points.length - 1];
    if (last && Math.abs(point.x - last.x) < MIN_STEP && Math.abs(point.y - last.y) < MIN_STEP) {
      return;
    }
    const next = { points: [...liveStroke.points, point] };
    setLiveStroke(next);
    const host = hostRef.current;
    if (host && next.points.length % 8 === 0 && targetsRef.current.size < MAX_TARGETS) {
      const label = labelAt(event.clientX, event.clientY, host, overlayRef.current);
      if (label) {
        targetsRef.current.add(label);
      }
    }
  };

  const handlePenUp = (): void => {
    if (!liveStroke) {
      return;
    }
    const stroke = liveStroke;
    setLiveStroke(null);
    // A stray click is not a drawing.
    if (stroke.points.length < 2) {
      return;
    }
    pendingRef.current = [...pendingRef.current, stroke];
    setLiveStrokes(pendingRef.current);
    idleRef.current = window.setTimeout(() => flush(), STROKE_IDLE_MS);
  };

  const handleGhostDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragGhost({ x: event.clientX, y: event.clientY });
  };

  const handleGhostMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragGhost) {
      return;
    }
    setDragGhost({ x: event.clientX, y: event.clientY });
  };

  const handleGhostUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragGhost) {
      return;
    }
    setDragGhost(null);
    const host = hostRef.current;
    const point = normalize(event.clientX, event.clientY);
    const rect = host?.getBoundingClientRect();
    const inside =
      rect !== undefined &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    // Dropped off the surface is a cancel: there is nothing to pin it to.
    if (host && point && inside) {
      onPlaceNote(point.x, point.y, labelAt(event.clientX, event.clientY, host, overlayRef.current));
    }
    onDisarmNote();
  };

  /**
   * Start tracking a pin, without taking the pointer yet.
   *
   * Capturing on the first press costs the double-click: the browser stops
   * pairing the two presses once they are retargeted, and opening the note is
   * the more common gesture of the two. The capture is taken on the first
   * move past the slop instead, which is the point where it is actually a
   * drag.
   */
  const handleNoteDown =
    (id: string) =>
    (event: React.PointerEvent<HTMLDivElement>): void => {
      event.stopPropagation();
      dragNoteRef.current = { id, startX: event.clientX, startY: event.clientY, captured: false };
    };

  const handleNoteMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragNoteRef.current;
    if (!drag || drag.captured) {
      return;
    }
    if (Math.abs(event.clientX - drag.startX) <= DRAG_SLOP && Math.abs(event.clientY - drag.startY) <= DRAG_SLOP) {
      return;
    }
    drag.captured = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleNoteUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragNoteRef.current;
    dragNoteRef.current = null;
    if (!drag || !drag.captured) {
      return;
    }
    const point = normalize(event.clientX, event.clientY);
    if (point) {
      onMoveNote(drag.id, point.x, point.y);
    }
  };

  const editingNote = editing ? notes.find((entry) => entry.id === editing) : undefined;

  return (
    <Box ref={hostRef} style={{ position: "relative" }}>
      {children}

      <svg
        ref={overlayRef}
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 3,
          touchAction: "none",
          cursor: penArmed ? "crosshair" : undefined,
          // Only an armed pen takes the pointer; otherwise the surface below
          // stays clickable and its own controls keep working.
          pointerEvents: penArmed ? "auto" : "none",
        }}
        onPointerDown={handlePenDown}
        onPointerMove={handlePenMove}
        onPointerUp={handlePenUp}
        onPointerCancel={handlePenUp}
      >
        {[...drawings.flatMap((drawing) => drawing.strokes), ...liveStrokes, ...(liveStroke ? [liveStroke] : [])].map(
          (stroke, index) => (
            <polyline
              key={index}
              points={pointsAttribute(stroke)}
              fill="none"
              stroke={MARKER}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              style={{ strokeWidth: 2 }}
            />
          ),
        )}
      </svg>

      {notes.map((note) => (
        <div
          key={note.id}
          style={{
            position: "absolute",
            left: `${note.x * 100}%`,
            top: `${note.y * 100}%`,
            transform: "translate(-50%, -50%)",
            zIndex: 4,
            cursor: "grab",
            touchAction: "none",
            lineHeight: 0,
            backgroundColor: "#ffffff",
            borderRadius: 6,
            padding: 3,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.35)",
            border: "1px solid rgba(0, 0, 0, 0.15)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onPointerDown={handleNoteDown(note.id)}
          onPointerMove={handleNoteMove}
          onPointerUp={handleNoteUp}
          onDoubleClick={() => {
            setEditing(note.id);
            setDraft(note.note);
          }}
        >
          <Tooltip label={note.note.trim() || "(no text)"} multiline w={240} position="top">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <IconNote size={24} color="#f59f00" stroke={2.5} />
            </div>
          </Tooltip>
        </div>
      ))}

      {noteArmed ? (
        <div
          style={
            dragGhost
              ? {
                  // Following the pointer means leaving the surface's own
                  // coordinate space, so the ghost goes viewport-fixed.
                  position: "fixed",
                  left: dragGhost.x,
                  top: dragGhost.y,
                  transform: "translate(-50%, -50%)",
                  zIndex: 5,
                  cursor: "grabbing",
                  touchAction: "none",
                  lineHeight: 0,
                  backgroundColor: "#ffffff",
                  borderRadius: 8,
                  padding: 6,
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
                  border: "2px solid #f59f00",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  // Mid-drag the glyph must not be what `labelAt` finds.
                  pointerEvents: "none",
                }
              : {
                  position: "absolute",
                  left: 8,
                  top: 8,
                  zIndex: 5,
                  cursor: "grab",
                  touchAction: "none",
                  lineHeight: 0,
                  backgroundColor: "#ffffff",
                  borderRadius: 8,
                  padding: 6,
                  boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
                  border: "2px solid #f59f00",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }
          }
          onPointerDown={handleGhostDown}
          onPointerMove={handleGhostMove}
          onPointerUp={handleGhostUp}
          onPointerCancel={handleGhostUp}
          aria-label="Drag the sticky note onto the surface"
        >
          <IconNote size={36} color="#f59f00" stroke={2.5} />
        </div>
      ) : null}

      <Modal
        opened={editingNote !== undefined}
        onClose={() => setEditing(null)}
        centered
        title="Annotation"
        zIndex={500}
      >
        <Textarea
          autosize
          minRows={3}
          maxRows={10}
          data-autofocus
          autoFocus
          value={draft}
          placeholder="What should the agent know about this?"
          onChange={(event) => setDraft(event.currentTarget.value)}
          aria-label="Annotation text"
        />
        <Group justify="space-between" mt="md">
          <Button
            variant="light"
            color="red"
            leftSection={<IconTrash size={14} />}
            onClick={() => {
              if (editingNote) {
                onDeleteAnnotation(editingNote.id);
              }
              setEditing(null);
            }}
          >
            Delete
          </Button>
          <Group gap={6}>
            <Button variant="subtle" color="gray" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              color="plum"
              onClick={() => {
                if (editingNote) {
                  onUpdateNote(editingNote.id, draft.trim());
                }
                setEditing(null);
              }}
            >
              Save
            </Button>
          </Group>
        </Group>
      </Modal>
    </Box>
  );
}
