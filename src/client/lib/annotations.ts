/**
 * User annotations: remarks pinned to a file selection or to an agent surface,
 * held in the browser until the next message carries them to the agent.
 *
 * The point is to remove the transcription step. A user who spots something in
 * a diff or in a rendered surface should be able to mark it and keep reading,
 * rather than stopping to type out a path, a line number and a quote — so an
 * annotation records where it was made, and `formatAnnotations` writes that
 * out as the references the user would otherwise have written by hand.
 *
 * Persisted per session in localStorage, following `settings.ts`: a remark is
 * about the conversation it was made in, and surviving a reload matters more
 * than surviving a session switch. Surface coordinates are normalized to
 * 0..1 because the agent redraws surfaces — `recreateSurface` deletes and
 * rebuilds one outright — and pixel offsets would drift off their target.
 */
import { useLocalStorage } from "@mantine/hooks";
import { useCallback } from "react";

import { newSendId } from "./outbox.ts";

/** A remark against a selection in the file viewer. */
export interface FileAnnotation {
  id: string;
  kind: "file";
  createdAt: string;
  /** Workspace-relative path, as the viewer had it. */
  path: string;
  /** Which of the viewer's three text views the selection was made in. */
  view: "raw" | "diff" | "rendered";
  /** The selected text, capped at 400 characters. */
  excerpt: string;
  /** 1-based position within the text that was on screen. */
  startLine?: number;
  startChar?: number;
  endLine?: number;
  endChar?: number;
  /** For `diff`: the line in the working file the selection starts on. */
  fileLine?: number;
  /** For `diff`: which side of the hunk `fileLine` counts against. */
  side?: "new" | "old" | "meta";
  note: string;
}

/** One freehand stroke, as points normalized against the surface box. */
export interface AnnotationStroke {
  points: Array<{ x: number; y: number }>;
}

/** Red marker strokes drawn over an agent surface. */
export interface SurfaceDrawingAnnotation {
  id: string;
  kind: "drawing";
  createdAt: string;
  surfaceId: string;
  strokes: AnnotationStroke[];
  /** Text the strokes passed over, so the agent knows what was circled. */
  targets: string[];
  note: string;
}

/** A sticky note pinned somewhere on an agent surface. */
export interface SurfaceNoteAnnotation {
  id: string;
  kind: "note";
  createdAt: string;
  surfaceId: string;
  /** Normalized 0..1 against the surface box. */
  x: number;
  y: number;
  /** Text under the pin, so the agent knows what it is attached to. */
  target?: string;
  note: string;
}

export type Annotation = FileAnnotation | SurfaceDrawingAnnotation | SurfaceNoteAnnotation;

/** An annotation as a caller supplies it; the store stamps id and time. */
export type NewAnnotation =
  | Omit<FileAnnotation, "id" | "createdAt">
  | Omit<SurfaceDrawingAnnotation, "id" | "createdAt">
  | Omit<SurfaceNoteAnnotation, "id" | "createdAt">;

export interface AnnotationStore {
  annotations: Annotation[];
  /** Append one, returning its id so the caller can open its editor at once. */
  add: (annotation: NewAnnotation) => string;
  /** Edit the note text. Nothing else about an annotation is editable. */
  update: (id: string, note: string) => void;
  /** Move a placed sticky note. */
  move: (id: string, x: number, y: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Put a cleared list back, for a send that failed. */
  restore: (annotations: Annotation[]) => void;
}

function isAnnotationList(value: unknown): value is Annotation[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    entry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Annotation).id === "string" &&
      typeof (entry as Annotation).kind === "string",
  );
}

export function useAnnotations(sessionKey: string | undefined): AnnotationStore {
  const [annotations, setAnnotations] = useLocalStorage<Annotation[]>({
    key: `omega:annotations:${sessionKey || "root"}`,
    defaultValue: [],
    // Read on the first render: the composer's count is part of the first
    // paint, and a deferred read would flash a session's annotations away.
    getInitialValueInEffect: false,
    deserialize: raw => {
      if (raw === undefined) return [];
      try {
        const parsed: unknown = JSON.parse(raw);
        return isAnnotationList(parsed) ? parsed : [];
      } catch {
        return [];
      }
    },
  });

  const add = useCallback(
    (annotation: NewAnnotation): string => {
      const id = newSendId();
      const stamped = { ...annotation, id, createdAt: new Date().toISOString() } as Annotation;
      setAnnotations(current => [...current, stamped]);
      return id;
    },
    [setAnnotations],
  );

  const update = useCallback(
    (id: string, note: string): void => {
      setAnnotations(current => current.map(entry => (entry.id === id ? { ...entry, note } : entry)));
    },
    [setAnnotations],
  );

  const move = useCallback(
    (id: string, x: number, y: number): void => {
      setAnnotations(current =>
        current.map(entry => (entry.id === id && entry.kind === "note" ? { ...entry, x, y } : entry)),
      );
    },
    [setAnnotations],
  );

  const remove = useCallback(
    (id: string): void => {
      setAnnotations(current => current.filter(entry => entry.id !== id));
    },
    [setAnnotations],
  );

  const clear = useCallback((): void => setAnnotations([]), [setAnnotations]);

  const restore = useCallback((list: Annotation[]): void => setAnnotations(list), [setAnnotations]);

  return { annotations, add, update, move, remove, clear, restore };
}

/**
 * Escape special characters inside XML attribute values.
 */
function escapeXmlAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Write the annotations out as pseudo-XML appended to the user's message.
 *
 * Pseudo-XML is cleanly bounded, structured, and immediately understood by LLMs
 * without ambiguous delimiter collisions or manual parsing ambiguity.
 */
export function formatAnnotations(annotations: Annotation[]): string {
  if (annotations.length === 0) return "";

  const items = annotations.map(annotation => {
    const noteText = annotation.note.trim();
    const noteTag = noteText ? `    <note>${noteText}</note>` : "    <note />";

    if (annotation.kind === "file") {
      const attrs: string[] = [`path="${escapeXmlAttr(annotation.path)}"`, `view="${annotation.view}"`];
      if (annotation.startLine !== undefined) {
        attrs.push(`lines="${annotation.startLine}-${annotation.endLine ?? annotation.startLine}"`);
        attrs.push(`col="${annotation.startChar ?? 1}"`);
      }
      if (annotation.view === "diff" && annotation.fileLine !== undefined) {
        attrs.push(`file_line="${annotation.fileLine}"`);
        if (annotation.side) attrs.push(`side="${annotation.side}"`);
      }

      const excerptTag = annotation.excerpt
        ? `    <excerpt>\n${annotation.excerpt.trim()}\n    </excerpt>`
        : "";

      return [`  <file_annotation ${attrs.join(" ")}>`, excerptTag, noteTag, "  </file_annotation>"]
        .filter(Boolean)
        .join("\n");
    }

    if (annotation.kind === "drawing") {
      const attrs: string[] = [`surface_id="${escapeXmlAttr(annotation.surfaceId)}"`];
      if (annotation.targets.length > 0) {
        attrs.push(`targets="${escapeXmlAttr(annotation.targets.join(", "))}"`);
      }

      return [`  <surface_drawing ${attrs.join(" ")}>`, noteTag, "  </surface_drawing>"].join("\n");
    }

    // Sticky note annotation
    const attrs: string[] = [
      `surface_id="${escapeXmlAttr(annotation.surfaceId)}"`,
      `x="${Math.round(annotation.x * 100)}%"`,
      `y="${Math.round(annotation.y * 100)}%"`,
    ];
    if (annotation.target) {
      attrs.push(`target="${escapeXmlAttr(annotation.target)}"`);
    }

    return [`  <surface_note ${attrs.join(" ")}>`, noteTag, "  </surface_note>"].join("\n");
  });

  return `<annotations count="${annotations.length}">\n${items.join("\n\n")}\n</annotations>`;
}
