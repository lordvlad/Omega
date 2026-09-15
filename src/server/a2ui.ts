/**
 * The A2UI tools omega hands the agent, and the channel that carries what
 * they emit to the browser.
 *
 * omp has no built-in A2UI surface, so the host provides one: four custom
 * tools mirroring the four agent-to-renderer messages of A2UI v1.0. Each call
 * validates its arguments against the shared wire types and pushes the
 * message onto the session's channel, which the `LiveSession` drains onto the
 * AG-UI socket as an `omp.a2ui` frame.
 *
 * The channel exists because of initialisation order: the tools have to be
 * built *before* `createAgentSession`, and the `LiveSession` that owns the
 * socket only exists after it. The channel is created first, handed to the
 * tools, and attached to the session afterwards; anything emitted in between
 * is buffered rather than dropped.
 *
 * Surface bookkeeping is kept here too, so the agent gets a real error for
 * updating a surface it never created instead of silently drawing nothing.
 */
import type { CustomTool } from "@oh-my-pi/pi-coding-agent";
import { jsonSchema, validate } from "wiz";

import {
  A2UI_BASIC_CATALOG_ID,
  A2UI_VERSION,
  type A2uiCreateSurface,
  type A2uiDeleteSurface,
  type A2uiMessage,
  type A2uiUpdateComponents,
  type A2uiUpdateDataModel,
} from "../shared/a2ui.ts";

/** Where a validated A2UI message goes once a session is attached. */
export type A2uiSink = (message: A2uiMessage) => void;

/**
 * Component types this renderer implements — the whole A2UI v1.0 basic
 * catalog. An `updateComponents` naming anything else is rejected, because a
 * component the renderer cannot draw is a hole in the UI the agent would
 * never hear about.
 */
export const A2UI_COMPONENTS: Record<string, true> = {
  Accordion: true,
  Alert: true,
  Anchor: true,
  AudioPlayer: true,
  Avatar: true,
  Badge: true,
  Button: true,
  Card: true,
  CheckBox: true,
  ChoicePicker: true,
  Code: true,
  Column: true,
  DateTimeInput: true,
  Divider: true,
  Icon: true,
  Image: true,
  List: true,
  Modal: true,
  Paper: true,
  Progress: true,
  Rating: true,
  RingProgress: true,
  Row: true,
  SegmentedControl: true,
  Skeleton: true,
  Slider: true,
  Switch: true,
  Table: true,
  Tabs: true,
  Text: true,
  TextField: true,
  Timeline: true,
  Tooltip: true,
  Video: true,
};

/** The same set as prose, for error messages and the catalog reference. */
const COMPONENT_NAMES = Object.keys(A2UI_COMPONENTS).join(", ");

/** Icon names the catalog defines, and the renderer maps to real glyphs. */
export const A2UI_ICONS = [
  "accountCircle",
  "add",
  "arrowBack",
  "arrowForward",
  "attachFile",
  "calendarToday",
  "call",
  "camera",
  "check",
  "close",
  "delete",
  "download",
  "edit",
  "event",
  "error",
  "fastForward",
  "favorite",
  "favoriteOff",
  "folder",
  "help",
  "home",
  "info",
  "locationOn",
  "lock",
  "lockOpen",
  "mail",
  "menu",
  "moreVert",
  "moreHoriz",
  "notificationsOff",
  "notifications",
  "pause",
  "payment",
  "person",
  "phone",
  "photo",
  "play",
  "print",
  "refresh",
  "rewind",
  "search",
  "send",
  "settings",
  "share",
  "shoppingCart",
  "skipNext",
  "skipPrevious",
  "star",
  "starHalf",
  "starOff",
  "stop",
  "upload",
  "visibility",
  "visibilityOff",
  "volumeDown",
  "volumeMute",
  "volumeOff",
  "volumeUp",
  "warning",
] as const;

/**
 * The catalog, as the agent needs to read it.
 *
 * Kept as prose on the tools rather than fetched from a catalog URL: the
 * agent has to know the component vocabulary at the moment it composes a
 * message, and `catalogId` is an identifier, not a resolvable document.
 */
const CATALOG_REFERENCE = `
Components (property: type — "dyn" accepts a literal or {"path":"/pointer"}):
- Text: text (dyn string, simple markdown), variant ("body" | "caption" | "heading")
- Badge: label (dyn string), color (string, e.g. "cyan", "plum", "red", "green", "yellow", "gray", "blue", "orange"), variant ("light" | "filled" | "outline" | "dot"), size ("xs" | "sm" | "md" | "lg")
- Alert: title (dyn string), text (dyn string), child (component id), color (string), icon (icon name), variant ("light" | "filled" | "outline")
- Avatar: src (dyn string), name (dyn string), size ("xs" | "sm" | "md" | "lg" | "xl"), radius ("xs" | "sm" | "md" | "lg" | "xl"), color (string)
- Progress: value (dyn number, 0-100), color (string), size ("xs" | "sm" | "md" | "lg" | "xl"), striped (boolean), animated (boolean)
- RingProgress: value (dyn number, 0-100), label (dyn string), color (string), size (number), thickness (number)
- Switch: label (dyn string), description (dyn string), value (dyn boolean, bind it), color (string)
- SegmentedControl: options (array of { label: dyn string, value: string }), value (dyn string, bind it), color (string), size ("xs" | "sm" | "md" | "lg")
- Rating: value (dyn number, bind it), count (number), color (string), size ("xs" | "sm" | "md" | "lg"), readOnly (boolean)
- Code: code (dyn string), language (string), block (boolean)
- Table: headers (array of dyn string), rows (array of array of dyn string), striped (boolean), highlightOnHover (boolean)
- Timeline: items (array of { title: dyn string, description: dyn string, time: dyn string, bullet: icon name }), active (dyn number), color (string)
- Accordion: items (array of { title: dyn string, child: component id, value: string }), defaultValue (string), variant ("default" | "contained" | "filled" | "separated")
- Paper: child (component id), shadow ("xs" | "sm" | "md" | "lg" | "xl"), radius ("xs" | "sm" | "md" | "lg" | "xl"), withBorder (boolean), p ("xs" | "sm" | "md" | "lg" | "xl")
- Anchor: href (dyn string), text (dyn string), child (component id), target ("_blank" | "_self"), underline ("always" | "hover" | "never")
- Skeleton: height (number), width (number | string), circle (boolean), animate (boolean)
- Tooltip: label (dyn string), child (component id)
- Icon: name (one of: ${A2UI_ICONS.join(", ")})
- Image: url (dyn string), description (dyn string), fit ("contain" | "cover" | "fill" | "none" | "scaleDown"), variant ("icon" | "avatar" | "smallFeature" | "mediumFeature" | "largeFeature" | "header")
- Video: url (dyn string), posterUrl (dyn string)
- AudioPlayer: url (dyn string), description (dyn string)
- Row: children, justify ("start" | "center" | "end" | "spaceBetween" | "spaceAround" | "spaceEvenly" | "stretch"), align ("start" | "center" | "end" | "stretch")
- Column: children, justify, align
- List: children, direction ("vertical" | "horizontal"), align
- Card: child (one component id)
- Tabs: tabs (array of { title: dyn string, child: component id })
- Modal: trigger (component id), content (component id)
- Divider: axis ("horizontal" | "vertical")
- Button: child (component id, usually a Text), variant ("default" | "primary" | "borderless"), action ({"event":{"name":"...","userMessage":"...","context":{...}}})
- TextField: label (dyn string), value (dyn string, bind it), placeholder (dyn string), variant ("shortText" | "longText" | "number" | "obscured")
- CheckBox: label (dyn string), value (dyn boolean, bind it)
- ChoicePicker: label (dyn string), options (array of { label: dyn string, value: string }), value (dyn string array, bind it), variant ("mutuallyExclusive" | "multipleSelection"), displayStyle ("checkbox" | "chips"), filterable (boolean)
- Slider: label (dyn string), value (dyn number, bind it), min, max, steps
- DateTimeInput: label (dyn string), value (dyn ISO 8601 string, bind it), enableDate, enableTime, min, max
Any component in a Row or Column may set "weight" (flex-grow).

Rules:
- Components are a flat adjacency list; parents name children by id.
- Exactly one component must have "id": "root". It is what gets mounted.
- "children" is either an array of ids, or {"componentId": "<template id>", "path": "/items"} to repeat one component per array element. Inside a template, a pointer without a leading "/" resolves against the current item and "@index" is its position.
- Bind a value to state with {"path": "/pointer"} and supply the state with a2ui_updateDataModel; interactive components write the user's input back to the bound pointer.
- Button actions are delivered to you as a user message in this conversation.
- Renderer-side catalog functions (the "checks" property, {"call": ...} values) are not implemented and are ignored.
`.trim();

/** Strip the meta keyword a tool schema has no use for. */
function parameters(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema, ...rest } = schema;
  void $schema;
  return rest;
}

/** One line per validation failure, in the shape wiz reports them. */
function explain(errors: ReadonlyArray<{ path: string; message: string }>): string {
  return errors.map(error => `- ${error.path}: ${error.message}`).join("\n");
}

/**
 * Per-session A2UI state: the surfaces that exist and where messages go.
 *
 * One instance is shared by the four tools of a session and by the
 * `LiveSession` that streams them, which is what makes the tools stateful
 * enough to answer "does this surface exist" without a round trip.
 */
export class A2uiChannel {
  #sink: A2uiSink | undefined;
  /** Messages emitted before the session attached. */
  readonly #buffered: A2uiMessage[] = [];
  readonly #surfaces = new Set<string>();

  /** Point the channel at a live session and flush whatever it missed. */
  attach(sink: A2uiSink): void {
    this.#sink = sink;
    for (const message of this.#buffered) sink(message);
    this.#buffered.length = 0;
  }

  /** Surface ids currently alive, in creation order. */
  get surfaces(): string[] {
    return [...this.#surfaces];
  }

  #emit(message: A2uiMessage): void {
    if (this.#sink) this.#sink(message);
    else this.#buffered.push(message);
  }

  createSurface(payload: A2uiCreateSurface): void {
    this.#surfaces.add(payload.surfaceId);
    this.#emit({ version: A2UI_VERSION, createSurface: payload });
  }

  updateComponents(payload: A2uiUpdateComponents): void {
    this.#emit({ version: A2UI_VERSION, updateComponents: payload });
  }

  updateDataModel(payload: A2uiUpdateDataModel): void {
    this.#emit({ version: A2UI_VERSION, updateDataModel: payload });
  }

  deleteSurface(payload: A2uiDeleteSurface): void {
    this.#surfaces.delete(payload.surfaceId);
    this.#emit({ version: A2UI_VERSION, deleteSurface: payload });
  }

  has(surfaceId: string): boolean {
    return this.#surfaces.has(surfaceId);
  }
}

/** A tool result carrying one line of text. */
function say(
  text: string,
  isError = false,
): { content: [{ type: "text"; text: string }]; isError?: boolean } {
  return isError
    ? { content: [{ type: "text", text }], isError: true }
    : { content: [{ type: "text", text }] };
}

/** `No surface …` plus what does exist, so a typo is self-correcting. */
function missing(channel: A2uiChannel, surfaceId: string): string {
  const live = channel.surfaces;
  return (
    `No surface "${surfaceId}" exists. ` +
    (live.length > 0
      ? `Live surfaces: ${live.join(", ")}.`
      : "Create one with a2ui_createSurface before updating it.")
  );
}

/** Component types in this list the renderer has no drawing for. */
function unknownTypes(components: ReadonlyArray<{ component: string }>): string[] {
  const bad = new Set<string>();
  for (const component of components) {
    if (A2UI_COMPONENTS[component.component] !== true) bad.add(component.component);
  }
  return [...bad];
}

/**
 * Build the four A2UI tools bound to one session's channel.
 *
 * `loadMode: "essential"` keeps them top-level rather than behind tool
 * discovery: drawing UI is a first-class capability of this host, and a tool
 * the model has to go looking for is a tool it will not reach for mid-answer.
 */
export function createA2uiTools(channel: A2uiChannel): CustomTool[] {
  const createSurface: CustomTool = {
    name: "a2ui_createSurface",
    label: "A2UI Create Surface",
    loadMode: "essential",
    approval: { tier: "read" },
    description:
      "Create an A2UI surface and draw it in the user's browser, next to this conversation. " +
      "A surface is one self-contained widget: a card, a form, a dashboard. Pass `components` " +
      "and `dataModel` here to render the whole thing in a single call, or leave them out and " +
      "follow up with a2ui_updateComponents. `surfaceId` must be new.\n\n" +
      CATALOG_REFERENCE,
    parameters: parameters(jsonSchema<A2uiCreateSurface>()),
    async execute(_toolCallId, params) {
      const errors = validate<A2uiCreateSurface>(params);
      if (errors.length > 0) return say(`Invalid createSurface:\n${explain(errors)}`, true);
      const payload = params as A2uiCreateSurface;
      if (channel.has(payload.surfaceId)) {
        return say(
          `Surface "${payload.surfaceId}" already exists. Update it with a2ui_updateComponents, ` +
            "or delete it first with a2ui_deleteSurface.",
          true,
        );
      }
      const bad = unknownTypes(payload.components ?? []);
      if (bad.length > 0) {
        return say(
          `Unsupported component types: ${bad.join(", ")}. This renderer implements ${COMPONENT_NAMES}.`,
          true,
        );
      }
      channel.createSurface({ catalogId: A2UI_BASIC_CATALOG_ID, ...payload });
      const count = payload.components?.length ?? 0;
      const rooted = (payload.components ?? []).some(component => component.id === "root");
      return say(
        `Surface "${payload.surfaceId}" created with ${count} component(s).` +
          (count > 0 && !rooted
            ? ' Nothing is mounted yet: no component has id "root".'
            : count === 0
              ? " Send its components with a2ui_updateComponents."
              : ""),
      );
    },
  };

  const updateComponents: CustomTool = {
    name: "a2ui_updateComponents",
    label: "A2UI Update Components",
    loadMode: "essential",
    approval: { tier: "read" },
    description:
      "Add or replace components in an existing A2UI surface. Components are a flat adjacency " +
      "list keyed by `id`; sending an id that already exists replaces it, which is how a " +
      "rendered surface is edited in place. The component with id `root` is the one mounted.\n\n" +
      CATALOG_REFERENCE,
    parameters: parameters(jsonSchema<A2uiUpdateComponents>()),
    async execute(_toolCallId, params) {
      const errors = validate<A2uiUpdateComponents>(params);
      if (errors.length > 0) return say(`Invalid updateComponents:\n${explain(errors)}`, true);
      const payload = params as A2uiUpdateComponents;
      if (!channel.has(payload.surfaceId)) return say(missing(channel, payload.surfaceId), true);
      const bad = unknownTypes(payload.components);
      if (bad.length > 0) {
        return say(
          `Unsupported component types: ${bad.join(", ")}. This renderer implements ${COMPONENT_NAMES}.`,
          true,
        );
      }
      channel.updateComponents(payload);
      return say(`Updated ${payload.components.length} component(s) on "${payload.surfaceId}".`);
    },
  };

  const updateDataModel: CustomTool = {
    name: "a2ui_updateDataModel",
    label: "A2UI Update Data Model",
    loadMode: "essential",
    approval: { tier: "read" },
    description:
      "Write to an A2UI surface's data model. `path` is a JSON Pointer (`/user/name`); omit it " +
      "or pass `/` to replace the whole model, and pass `value: null` to delete a key. Every " +
      "component bound to a pointer under the written path re-renders, so content changes need " +
      "no component update.",
    parameters: parameters(jsonSchema<A2uiUpdateDataModel>()),
    async execute(_toolCallId, params) {
      const errors = validate<A2uiUpdateDataModel>(params);
      if (errors.length > 0) return say(`Invalid updateDataModel:\n${explain(errors)}`, true);
      const payload = params as A2uiUpdateDataModel;
      if (!channel.has(payload.surfaceId)) return say(missing(channel, payload.surfaceId), true);
      const path = payload.path;
      if (path !== undefined && path !== "" && path !== "/" && !path.startsWith("/")) {
        return say(`path must be a JSON Pointer starting with "/", got "${path}".`, true);
      }
      channel.updateDataModel(payload);
      return say(`Data model of "${payload.surfaceId}" updated at ${path && path !== "/" ? path : "/"}.`);
    },
  };

  const deleteSurface: CustomTool = {
    name: "a2ui_deleteSurface",
    label: "A2UI Delete Surface",
    loadMode: "essential",
    approval: { tier: "read" },
    description:
      "Remove an A2UI surface from the user's browser, along with its components and data. Use " +
      "it when the widget is finished with — a submitted form, a dismissed prompt.",
    parameters: parameters(jsonSchema<A2uiDeleteSurface>()),
    async execute(_toolCallId, params) {
      const errors = validate<A2uiDeleteSurface>(params);
      if (errors.length > 0) return say(`Invalid deleteSurface:\n${explain(errors)}`, true);
      const payload = params as A2uiDeleteSurface;
      if (!channel.has(payload.surfaceId)) return say(missing(channel, payload.surfaceId), true);
      channel.deleteSurface(payload);
      return say(`Surface "${payload.surfaceId}" deleted.`);
    },
  };

  return [createSurface, updateComponents, updateDataModel, deleteSurface];
}
