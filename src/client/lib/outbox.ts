/**
 * The outbox: sends that have been handed over but not yet delivered.
 *
 * A message typed with no network is not refused and not left in the box —
 * React Query parks the mutation and runs it when the network returns, and
 * `main.tsx` persists the parked ones so closing the tab does not lose them.
 *
 * What is missing from that is any sign of it, which is what this is for: the
 * count of sends waiting on a network, read straight from the mutation cache
 * rather than tracked a second time alongside it.
 */
import { useMutationState } from "@tanstack/react-query";

import { getPromptMutationOptions } from "../api/mutations.ts";

/** How many messages are parked, waiting for the network. */
export function useQueuedSends(): number {
  const paused = useMutationState({
    filters: { mutationKey: getPromptMutationOptions().mutationKey, status: "pending" },
    select: mutation => mutation.state.isPaused,
  });
  return paused.filter(Boolean).length;
}

/**
 * An id for one send, unique enough to deduplicate its own retries.
 *
 * `crypto.randomUUID` is unavailable here: it is restricted to secure
 * contexts, and omega's whole point is being reached over a home LAN at
 * `http://hostname:4319`. `getRandomValues` carries no such restriction, so
 * the bytes come from there and are formatted by hand; the `Math.random`
 * fallback exists only for a browser old enough to have neither, where a
 * collision costs one dropped duplicate rather than anything worse.
 */
export function newSendId(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
