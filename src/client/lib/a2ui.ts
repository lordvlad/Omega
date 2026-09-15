/**
 * Client-side A2UI surface state and RFC 6901 JSON Pointer binding.
 *
 * Incoming `omp.a2ui` custom frames are reduced into `ClientSurface` records
 * here. Surfaces hold their component adjacency list in a Map and their data
 * model in a plain object; changes bump a per-surface revision counter so
 * React components observing one surface re-render cleanly.
 */
import type { A2uiComponent, A2uiDataBinding, A2uiDynamic, A2uiMessage } from "../../shared/a2ui.ts";

/** One active surface on the client. */
export interface ClientSurface {
  surfaceId: string;
  catalogId?: string;
  sendDataModel?: boolean;
  components: Map<string, A2uiComponent>;
  dataModel: Record<string, unknown>;
  revision: number;
}

/**
 * Decode RFC 6901 JSON Pointer token (`~1` -> `/`, `~0` -> `~`).
 */
function unescapePointerToken(token: string): string {
  return token.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

/**
 * Split a JSON pointer into unescaped segment tokens.
 * A leading `/` is ignored. Empty pointer or `/` yields empty array (root).
 */
function parsePointerSegments(pointer: string): string[] {
  if (!pointer || pointer === "/") return [];
  const clean = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return clean.split("/").map(unescapePointerToken);
}

/**
 * Read a value from a data model by RFC 6901 JSON Pointer.
 *
 * If `pointer` starts with `/`, it is resolved from `root`.
 * Otherwise, it is resolved against `scope` (current array item in a template).
 * The special identifier `@index` resolves to the current template item index.
 */
export function resolvePointer(
  root: unknown,
  pointer: string | undefined,
  scope?: unknown,
  index?: number,
): unknown {
  if (pointer === undefined) return undefined;
  if (pointer === "@index") return index;

  const isAbsolute = pointer.startsWith("/");
  const target = isAbsolute ? root : (scope ?? root);
  const segments = parsePointerSegments(pointer);

  let current: unknown = target;
  for (const segment of segments) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
    } else if (typeof current === "object" && segment in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Resolve a dynamic value (literal or `{ path: "..." }`) against data model.
 */
export function resolveDynamic<T>(
  dyn: A2uiDynamic<T> | undefined,
  root: unknown,
  scope?: unknown,
  index?: number,
): T | undefined {
  if (dyn === undefined || dyn === null) return undefined;
  if (typeof dyn === "object" && "path" in dyn) {
    const binding = dyn as A2uiDataBinding;
    if (typeof binding.path === "string") {
      return resolvePointer(root, binding.path, scope, index) as T | undefined;
    }
  }
  return dyn as T;
}

/**
 * Write a value into a data model at an RFC 6901 JSON Pointer.
 * Mutates `root` in place (or sets properties creating intermediate objects/arrays).
 */
export function setPointer(root: Record<string, unknown>, pointer: string | undefined, value: unknown): void {
  if (!pointer || pointer === "/" || pointer === "") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const k of Object.keys(root)) delete root[k];
      Object.assign(root, value);
    }
    return;
  }

  const segments = parsePointerSegments(pointer);
  if (segments.length === 0) return;

  let current: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const nextSeg = segments[i + 1]!;
    const nextIsNum = /^\d+$/u.test(nextSeg);

    if (Array.isArray(current)) {
      const idx = Number(seg);
      if (current[idx] == null || typeof current[idx] !== "object") {
        current[idx] = nextIsNum ? [] : {};
      }
      current = current[idx] as Record<string, unknown> | unknown[];
    } else {
      if (current[seg] == null || typeof current[seg] !== "object") {
        current[seg] = nextIsNum ? [] : {};
      }
      current = current[seg] as Record<string, unknown> | unknown[];
    }
  }

  const last = segments[segments.length - 1]!;
  if (value === null) {
    if (Array.isArray(current)) {
      const idx = Number(last);
      if (Number.isInteger(idx) && idx >= 0 && idx < current.length) {
        current.splice(idx, 1);
      }
    } else if (typeof current === "object" && current !== null) {
      delete (current as Record<string, unknown>)[last];
    }
  } else if (Array.isArray(current)) {
    const idx = Number(last);
    current[idx] = value;
  } else {
    (current as Record<string, unknown>)[last] = value;
  }
}

/**
 * Reduce an incoming A2UI message into the client surfaces map.
 * Returns the updated Map.
 */
export function reduceA2uiMessage(
  surfaces: Map<string, ClientSurface>,
  message: A2uiMessage,
): Map<string, ClientSurface> {
  const next = new Map(surfaces);

  if (message.createSurface) {
    const p = message.createSurface;
    const comps = new Map<string, A2uiComponent>();
    if (p.components) {
      for (const c of p.components) comps.set(c.id, c);
    }
    next.set(p.surfaceId, {
      surfaceId: p.surfaceId,
      catalogId: p.catalogId,
      sendDataModel: p.sendDataModel,
      components: comps,
      dataModel: p.dataModel ? { ...p.dataModel } : {},
      revision: 1,
    });
  } else if (message.updateComponents) {
    const p = message.updateComponents;
    const existing = next.get(p.surfaceId);
    if (existing) {
      const comps = new Map(existing.components);
      for (const c of p.components) comps.set(c.id, c);
      next.set(p.surfaceId, {
        ...existing,
        components: comps,
        revision: existing.revision + 1,
      });
    }
  } else if (message.updateDataModel) {
    const p = message.updateDataModel;
    const existing = next.get(p.surfaceId);
    if (existing) {
      const dataModel = { ...existing.dataModel };
      setPointer(dataModel, p.path, p.value);
      next.set(p.surfaceId, {
        ...existing,
        dataModel,
        revision: existing.revision + 1,
      });
    }
  } else if (message.deleteSurface) {
    next.delete(message.deleteSurface.surfaceId);
  }

  return next;
}

/** Resolve action context bindings into a plain key-value object. */
export function resolveActionContext(
  context: Record<string, unknown> | undefined,
  root: unknown,
  scope?: unknown,
  index?: number,
): Record<string, unknown> {
  if (!context) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    result[key] = resolveDynamic(value as A2uiDynamic<unknown>, root, scope, index);
  }
  return result;
}
