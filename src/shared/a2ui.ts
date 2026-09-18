/**
 * A2UI v1.0 wire types.
 *
 * The agent draws UI by streaming A2UI messages; omega carries them to the
 * browser on the AG-UI socket as `omp.a2ui` custom frames, which is the
 * AG-UI transport binding the specification names. These declarations are the
 * single source of that contract: the server derives the tool parameter
 * schemas from them with `jsonSchema<T>()` and validates incoming tool
 * arguments against them with `validate<T>()`, and the renderer consumes the
 * same types, so the schema the agent is shown cannot drift from the shape
 * the renderer handles.
 *
 * Only the four agent-to-renderer messages are modelled. Bidirectional
 * function calls (`callRendererFunction`, `callAgentFunction`) are not
 * implemented: this renderer registers no catalog functions, so there is
 * nothing an agent could legitimately call.
 */

/** Protocol version stamped on every message. */
export const A2UI_VERSION = "v1.0";

/** The catalog this renderer implements, and the default for every surface. */
export const A2UI_BASIC_CATALOG_ID = "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json";

/**
 * The telemetry surfaces omega draws itself, rather than the agent.
 *
 * The client has to tell the two apart: annotation tools belong on what the
 * agent drew, not on omega's own dashboards.
 */
export const COST_SURFACE_ID = "session-cost";
export const USAGE_SURFACE_ID = "session-usage";
export const STATS_SURFACE_ID = "session-stats";
export const WT_SURFACE_ID = "session-wt";
export const GC_SURFACE_ID = "session-gc";

/** True when the surface came from the agent rather than from omega itself. */
export function isAgentSurface(surfaceId: string): boolean {
  return (
    surfaceId !== COST_SURFACE_ID &&
    surfaceId !== USAGE_SURFACE_ID &&
    surfaceId !== STATS_SURFACE_ID &&
    surfaceId !== WT_SURFACE_ID &&
    surfaceId !== GC_SURFACE_ID
  );
}

/**
 * A reference into the surface's data model, as an RFC 6901 JSON Pointer.
 *
 * A leading `/` is absolute. Inside a template — a `children` list generated
 * from an array — a pointer without one resolves against the current item,
 * and `@index` is the item's zero-based position.
 */
export interface A2uiDataBinding {
  path: string;
}

/** A literal value, or a data binding that produces one. */
export type A2uiDynamic<Value> = Value | A2uiDataBinding;

/** A `children` list: static ids, or a template repeated over a data array. */
export type A2uiChildList = string[] | A2uiChildTemplate;

/** Repeat `componentId` once per element of the array at `path`. */
export interface A2uiChildTemplate {
  componentId: string;
  path: string;
}

/** The event a control dispatches to the agent when the user acts on it. */
export interface A2uiActionEvent {
  /** Action name the agent chose, e.g. `submit_order`. */
  name: string;
  /** Human-readable description of what the user did. */
  userMessage?: A2uiDynamic<string>;
  /** Extra values to deliver with the event; each may be a data binding. */
  context?: Record<string, unknown>;
}

/** What a `Button` does when pressed. */
export interface A2uiAction {
  event: A2uiActionEvent;
}

/**
 * One component of a surface's adjacency list.
 *
 * `component` names a catalog type (`Text`, `Column`, `Button`, …) and the
 * remaining properties are that type's own, in the flat v1.0 form:
 * `{ "id": "title", "component": "Text", "text": "Hello" }`.
 */
export interface A2uiComponent {
  /** Unique within the surface. The component with id `root` is mounted. */
  id: string;
  /** Catalog component type. */
  component: string;
  /** Overrides the surface's catalog for this component. */
  catalogId?: string;
  [property: string]: unknown;
}

/** Create a surface, optionally with its whole UI in one message. */
export interface A2uiCreateSurface {
  surfaceId: string;
  catalogId?: string;
  sendDataModel?: boolean;
  components?: A2uiComponent[];
  dataModel?: Record<string, unknown>;
}

/** Add or replace components in a surface, keyed by id. */
export interface A2uiUpdateComponents {
  surfaceId: string;
  components: A2uiComponent[];
}

/** Replace the value at `path` in a surface's data model. */
export interface A2uiUpdateDataModel {
  surfaceId: string;
  path?: string;
  value: unknown;
}

/** Remove a surface and everything it holds. */
export interface A2uiDeleteSurface {
  surfaceId: string;
}

/**
 * One agent-to-renderer message, as it rides an `omp.a2ui` frame.
 *
 * Exactly one of the four message keys is set, which is how the renderer
 * dispatches.
 */
export interface A2uiMessage {
  version: string;
  createSurface?: A2uiCreateSurface;
  updateComponents?: A2uiUpdateComponents;
  updateDataModel?: A2uiUpdateDataModel;
  deleteSurface?: A2uiDeleteSurface;
}

/**
 * A user interaction travelling back to the agent.
 *
 * The return channel is omega's ordinary prompt route rather than a second
 * protocol: the agent reads the action as a message in the conversation it is
 * already having, so an approval or a form submission is part of the
 * transcript instead of an invisible side channel.
 */
export interface A2uiActionReport {
  surfaceId: string;
  name: string;
  userMessage?: string;
  context?: Record<string, unknown>;
  /** The surface's data model, when it was created with `sendDataModel`. */
  dataModel?: unknown;
}
