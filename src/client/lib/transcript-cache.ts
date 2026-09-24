import { useEffect, useRef } from "react";
/**
 * Browser-side transcript persistence.
 *
 * A session URL is linkable, so a reload is a normal way to arrive at a
 * conversation — and until the fetch lands there is nothing to show. Worse,
 * the server releases idle sessions, so the transcript request answers
 * `404 Session is not open` until something re-opens it. In both cases the
 * conversation was on screen a moment ago and the user has every reason to
 * expect it still to be.
 *
 * So the last transcript seen for a session is kept in the browser and seeded
 * into the query cache when that session is opened again. The network fetch
 * still runs; it simply overwrites a screen that already reads correctly
 * instead of one that reads "no messages".
 *
 * Why IndexedDB and one record per session, rather than the usual
 * `persistQueryClient` over localStorage:
 *
 *   - Size. A four-message transcript here serialises to ~100 KB and the
 *     largest session on this machine is 37 MB. localStorage's ~5 MB budget
 *     is not in the right order of magnitude, and its writes are synchronous,
 *     so a megabyte write janks the main thread.
 *   - Shape. `persistClient` takes the whole dehydrated cache and writes it as
 *     one value, so persisting one session rewrites every other cached
 *     session on every write. Per-session records make a write O(1) in the
 *     number of cached conversations rather than O(all of them).
 *   - Scope. A blanket persister would also carry the 100 KB model list and
 *     the workspace tree, neither of which is worth a byte of disk: both are
 *     cheap to refetch and neither is what the user is staring at.
 *
 * Persistence is best-effort throughout. Private-mode IndexedDB failures,
 * quota rejections and corrupt records all resolve to "no cached transcript",
 * which is exactly the behaviour that existed before this file.
 */
import { useQueryClient } from "@tanstack/react-query";
import type { GetTranscriptOptions } from "../api/api.ts";
import type { Transcript, TranscriptMessage } from "../api/model.ts";
import { getGetTranscriptQueryOptions } from "../api/queries.ts";

/**
 * The shape the query cache holds, rebuilt from a cached message list.
 *
 * `hasMore: false` on purpose: a seed is what the browser last saw, and
 * offering "load older" against a cached window the server has not confirmed
 * would promise history this record cannot produce. The refetch that follows
 * carries the real answer.
 */
function toTranscript(key: string, messages: TranscriptMessage[]): Transcript {
  return { key, messages, hasMore: false };
}

const DB_NAME = "omega";
const DB_VERSION = 1;
const STORE = "transcripts";

/**
 * How many conversations to keep.
 *
 * Bounded because transcripts are large and a long-lived browser profile would
 * otherwise accumulate every session ever opened. Ten covers the handful a
 * person actually moves between; the rest cost one fetch, which is the status
 * quo for them anyway.
 */
const MAX_ENTRIES = 10;

interface CachedTranscript {
  key: string;
  messages: TranscriptMessage[];
  savedAt: number;
}

/** Single connection, opened on first use. */
let connection: Promise<IDBDatabase | undefined> | undefined;

function open(): Promise<IDBDatabase | undefined> {
  if (connection) {
    return connection;
  }
  connection = new Promise<IDBDatabase | undefined>((resolve) => {
    // Absent in some embedded webviews, and throws outright in Firefox's
    // private mode rather than returning null.
    let request: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === "undefined") {
        return resolve(undefined);
      }
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(undefined);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        // Pruning is "drop the least recently written", so that ordering has
        // to be an index rather than a full scan of multi-megabyte records.
        store.createIndex("savedAt", "savedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
  return connection;
}

/** Resolve when the transaction settles; never reject. */
function settled(tx: IDBTransaction): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
    tx.onabort = () => resolve(false);
  });
}

/** The transcript last seen for this session, if one was kept. */
export async function readTranscript(key: string): Promise<TranscriptMessage[] | undefined> {
  const db = await open();
  if (!db) {
    return undefined;
  }
  try {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    const record = await new Promise<CachedTranscript | undefined>((resolve) => {
      request.onsuccess = () => resolve(request.result as CachedTranscript | undefined);
      request.onerror = () => resolve(undefined);
    });
    // A record written by an older, differently-shaped build is not worth a
    // migration: treat anything unexpected as a miss and let the fetch answer.
    if (!record || !Array.isArray(record.messages)) {
      return undefined;
    }
    return record.messages;
  } catch {
    return undefined;
  }
}

/** Keep only the newest `MAX_ENTRIES` records. */
async function prune(db: IDBDatabase): Promise<void> {
  try {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const countRequest = store.count();
    const total = await new Promise<number>((resolve) => {
      countRequest.onsuccess = () => resolve(countRequest.result);
      countRequest.onerror = () => resolve(0);
    });
    if (total <= MAX_ENTRIES) {
      return;
    }

    let excess = total - MAX_ENTRIES;
    // Oldest first, deleting until the budget is met.
    const cursorRequest = store.index("savedAt").openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || excess <= 0) {
        return;
      }
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
    await settled(tx);
  } catch {
    // Pruning is housekeeping; failing it must not fail the write.
  }
}

/** Remember this transcript as the one to show next time the session opens. */
export async function writeTranscript(key: string, messages: TranscriptMessage[]): Promise<void> {
  const db = await open();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(STORE, "readwrite");
    const record: CachedTranscript = { key, messages, savedAt: Date.now() };
    tx.objectStore(STORE).put(record);
    // A quota rejection surfaces here as a failed transaction, which is a
    // reason to stop caching, never a reason to interrupt the conversation.
    const ok = await settled(tx);
    if (ok) {
      await prune(db);
    }
  } catch {
    // Best-effort.
  }
}

/** Drop one session's cached transcript, e.g. when it is deleted. */
export async function forgetTranscript(key: string): Promise<void> {
  const db = await open();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    await settled(tx);
  } catch {
    // Best-effort.
  }
}

/**
 * Seed a session's transcript from the browser cache, and keep that cache
 * current as the server answers.
 *
 * Seeding writes straight into the query cache rather than into React state
 * beside it, so every consumer — the transcript, the loading flag, the
 * scroll-tailing effect — sees one value with one meaning. The fetch that
 * follows is an ordinary background refetch.
 */
export function usePersistedTranscript(
  sessionKey: string | undefined,
  data: Transcript | undefined,
  query: GetTranscriptOptions["query"],
): void {
  const queryClient = useQueryClient();
  /** Messages already written, so a seed is not echoed straight back to disk. */
  const written = useRef<TranscriptMessage[] | undefined>(undefined);
  /** The window the seed has to land on; a different one is a different key. */
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    written.current = undefined;
    if (!sessionKey) {
      return;
    }

    let cancelled = false;
    const { queryKey } = getGetTranscriptQueryOptions({
      path: { key: sessionKey },
      query: queryRef.current,
    });

    void readTranscript(sessionKey).then((messages) => {
      // The fetch can win the race, and a cached transcript is by definition
      // the older of the two. Seeding is only ever for an empty cache.
      if (cancelled || !messages) {
        return;
      }
      if (queryClient.getQueryData(queryKey) !== undefined) {
        return;
      }
      written.current = messages;
      queryClient.setQueryData(queryKey, toTranscript(sessionKey, messages));
    });

    return () => {
      cancelled = true;
    };
  }, [sessionKey, queryClient]);

  useEffect(() => {
    if (!sessionKey || !data) {
      return;
    }
    // Identity is enough: the query cache hands back the same array until a
    // fetch replaces it, so this skips both the seed round-trip and the
    // re-renders a streaming turn causes between transcript refetches.
    if (written.current === data.messages) {
      return;
    }
    written.current = data.messages;
    void writeTranscript(sessionKey, data.messages);
  }, [sessionKey, data]);
}
