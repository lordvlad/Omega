/**
 * Reading and rewriting the queue of messages waiting to be delivered.
 *
 * omp keeps two ordered lanes on the agent — steering, drained at the turn's
 * next step, and follow-up, drained when the turn ends — and exposes them as
 * a live view (`peekSteeringQueue`, `peekFollowUpQueue`) plus a wholesale
 * setter (`replaceQueues`). There is no per-message id, so a position within
 * the lane is the handle, guarded by the text the client last saw: the agent
 * drains on its own schedule and a bare index would otherwise let an edit
 * land on whatever message slid into the slot.
 *
 * Only `role: "user"` messages are offered. The lanes also carry agent-authored
 * entries — advisor cards, hidden magic-keyword notices, vision companions —
 * which are not the user's to edit and whose text does not round-trip through
 * a textarea. Those are preserved untouched by every operation here.
 */
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";

import type { QueueDropRequest, QueueEditRequest, QueuedMessage, QueueLane } from "../shared/model.ts";
import type { LiveSession } from "./registry.ts";
import { HttpError } from "./router.ts";

/** A queued message the user wrote, and may therefore edit. */
function isUserPrompt(message: AgentMessage): boolean {
  return message.role === "user";
}

/**
 * A hidden entry omp queues immediately before a user prompt to carry context
 * for it — a magic-keyword notice, or image descriptions for a text-only
 * model. Dropping the prompt has to drop these too, or the agent receives
 * context for a message that never arrives. This mirrors the companion
 * handling in omp's own `popLastQueuedMessage`.
 */
function isHiddenCompanion(message: AgentMessage): boolean {
  return message.role === "custom" && message.attribution === "user" && message.display === false;
}

/** The visible text of a queued user prompt. */
function promptText(message: AgentMessage | undefined): string {
  if (!message || message.role !== "user") return "";
  const content = message.content;
  if (typeof content === "string") return content;
  for (const part of content) {
    if (part.type === "text") return part.text;
  }
  // A prompt can be images alone; it has no text to edit but still occupies a
  // slot, so it is listed rather than silently skipped.
  return "";
}

/**
 * The same message carrying different text.
 *
 * Structure is preserved rather than rebuilt: an image-carrying prompt keeps
 * its images, and only the first text part is replaced. A prompt that had no
 * text part gains one at the front, which is where a user typing into the
 * drawer expects their words to land.
 */
function withText(message: AgentMessage, text: string): AgentMessage {
  if (message.role !== "user") return message;
  const content = message.content;
  if (typeof content === "string") return { ...message, content: text };

  const next = content.slice();
  const at = next.findIndex(part => part.type === "text");
  if (at < 0) next.unshift({ type: "text", text });
  else next[at] = { type: "text", text };
  return { ...message, content: next };
}

/** Positions of the user prompts in a lane, oldest first. */
function promptPositions(lane: readonly AgentMessage[]): number[] {
  const positions: number[] = [];
  for (let at = 0; at < lane.length; at++) {
    const message = lane[at];
    if (message && isUserPrompt(message)) positions.push(at);
  }
  return positions;
}

function lanes(live: LiveSession): { steer: readonly AgentMessage[]; followUp: readonly AgentMessage[] } {
  const agent = live.session.agent;
  return { steer: agent.peekSteeringQueue(), followUp: agent.peekFollowUpQueue() };
}

/** Every queued user message, steering lane first. */
export function listQueue(live: LiveSession): QueuedMessage[] {
  const { steer, followUp } = lanes(live);
  const collect = (lane: readonly AgentMessage[], name: QueueLane): QueuedMessage[] =>
    promptPositions(lane).map((at, index) => ({ lane: name, index, text: promptText(lane[at]) }));
  return [...collect(steer, "steer"), ...collect(followUp, "followUp")];
}

/**
 * Resolve a lane position to an index into the raw queue, refusing when the
 * message there is not the one the client was looking at.
 */
function locate(
  lane: readonly AgentMessage[],
  index: number,
  expected: string,
): { at: number; message: AgentMessage } {
  const at = promptPositions(lane)[index];
  const message = at === undefined ? undefined : lane[at];
  if (at === undefined || !message) {
    throw new HttpError(409, "That message is no longer queued; the agent has already taken it.");
  }
  if (promptText(message) !== expected) {
    throw new HttpError(409, "The queue moved while you were editing. Reopen it and try again.");
  }
  return { at, message };
}

/** Write both lanes back, leaving the untouched one exactly as it was. */
function commit(live: LiveSession, which: QueueLane, next: AgentMessage[]): QueuedMessage[] {
  const { steer, followUp } = lanes(live);
  live.session.agent.replaceQueues(
    which === "steer" ? next : steer.slice(),
    which === "followUp" ? next : followUp.slice(),
  );
  live.touch();
  return listQueue(live);
}

/** Rewrite one queued message, keeping its lane and position. */
export function editQueued(live: LiveSession, body: QueueEditRequest): QueuedMessage[] {
  const text = body.text.trim();
  if (!text) throw new HttpError(400, "Message is empty. Drop it instead of blanking it.");

  const lane = body.lane === "steer" ? lanes(live).steer : lanes(live).followUp;
  const { at, message } = locate(lane, body.index, body.expected);
  const next = lane.slice();
  next[at] = withText(message, text);
  return commit(live, body.lane, next);
}

/** Drop one queued message, along with any hidden companions queued for it. */
export function dropQueued(live: LiveSession, body: QueueDropRequest): QueuedMessage[] {
  const lane = body.lane === "steer" ? lanes(live).steer : lanes(live).followUp;
  const { at } = locate(lane, body.index, body.expected);

  let from = at;
  for (let back = at - 1; back >= 0; back--) {
    const companion = lane[back];
    if (!companion || !isHiddenCompanion(companion)) break;
    from = back;
  }
  const next = lane.slice();
  next.splice(from, at - from + 1);
  return commit(live, body.lane, next);
}
