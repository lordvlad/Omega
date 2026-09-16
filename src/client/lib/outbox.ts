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
