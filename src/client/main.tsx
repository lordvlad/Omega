/**
 * Client entry.
 *
 * The colour scheme is forced dark: the theme is a dark purple/teal design and
 * has no light variant worth offering.
 */
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/code-highlight/styles.css";
import "@mantine/spotlight/styles.css";
import "@mantine/charts/styles.css";
import "./styles.css";
import { CodeHighlightAdapterProvider, createShikiAdapter } from "@mantine/code-highlight";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHighlighter } from "shiki";

import { configure } from "./api/api.ts";
import { getPromptMutationOptions } from "./api/mutations.ts";
import { router } from "./router.tsx";
import { theme } from "./theme.ts";

// The generated client defaults to same-origin, which is what we serve from.
configure({ baseUrl: "" });

/**
 * Mantine's highlighter, backed by shiki loaded on demand.
 *
 * shiki is a large bundle and the transcript is readable without it, so it is
 * imported lazily: code blocks render as plain monospace and re-highlight once
 * the highlighter and the block's grammar have loaded.
 */
const shikiAdapter = createShikiAdapter(() =>
  createHighlighter({
    langs: [
      "typescript",
      "javascript",
      "ts",
      "js",
      "tsx",
      "jsx",
      "json",
      "bash",
      "sh",
      "python",
      "py",
      "markdown",
      "md",
      "html",
      "css",
      "yaml",
      "yml",
      "diff",
    ],
    themes: [],
  }),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The WebSocket is the change notification, so polling would only add
      // load; refetch on focus covers a phone returning from the background.
      refetchOnWindowFocus: true,
      staleTime: 5_000,
      retry: 1,
    },
    mutations: {
      // `online` is what makes a send survive a dead network: React Query
      // parks the mutation instead of failing it, and runs it when the
      // network comes back. A few retries on top cover the server being
      // restarted while the link itself is up.
      networkMode: "online",
      retry: 3,
      retryDelay: attempt => Math.min(1_000 * 2 ** attempt, 15_000),
    },
  },
});

/**
 * Teach the cache how to replay a parked send after a reload.
 *
 * A mutation restored from storage arrives as arguments and a key — the
 * function that performs it cannot be serialised. Registering the generated
 * options under the same key is what lets a message typed offline, on a tab
 * that was then closed, still be delivered when the network returns.
 */
queryClient.setMutationDefaults(getPromptMutationOptions().mutationKey, getPromptMutationOptions());

/**
 * The outbox.
 *
 * Only parked mutations are written: queries have their own transcript cache,
 * and persisting them here would fight it. What survives a reload is exactly
 * what has not been delivered yet.
 */
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "omega:outbox",
  throttleTime: 200,
});

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <CodeHighlightAdapterProvider adapter={shikiAdapter}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{
            persister,
            dehydrateOptions: {
              shouldDehydrateQuery: () => false,
              // Parked sends, and — while there is no network — sends that
              // have been resumed but cannot have reached anything. Resuming
              // clears `isPaused` before the request can succeed, and writing
              // a snapshot in that window is how a queued message disappears
              // when the tab is closed. With no network there is nothing for
              // a re-send to duplicate.
              shouldDehydrateMutation: mutation =>
                mutation.state.isPaused || (mutation.state.status === "pending" && !onlineManager.isOnline()),
            },
          }}
          onSuccess={() => {
            // Only when there is something to send into. Resuming while
            // offline un-parks the send for nothing and loses the state that
            // says it is still waiting; React Query resumes parked mutations
            // by itself the moment the network is back.
            if (onlineManager.isOnline()) void queryClient.resumePausedMutations();
          }}
        >
          <Notifications position="top-right" limit={3} />
          {/* The server serves the SPA on every path, so `/w/…/s/…` history
              routing needs no hash and no server-side route table. */}
          <RouterProvider router={router} />
        </PersistQueryClientProvider>
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  </StrictMode>,
);

/**
 * Attach the manifest and icon links.
 *
 * These belong in `index.html`, and cannot live there: Bun's HTML loader
 * lists `link[rel=manifest]`, `link[rel=icon]` and `link[rel=apple-touch-icon]`
 * among the tags it treats as bundle entrypoints, so it rewrites each href to
 * a content-hashed URL. It leaves a href alone only when it is an absolute
 * http(s) URL, which is no use to a server reached at whatever LAN address
 * the phone happens to use. Hashing would also break the manifest, whose own
 * icon entries name `/icon-192.png` and friends by fixed path.
 *
 * Attached synchronously here, before first paint, so the manifest is in the
 * document by the time an install prompt or "Add to Home Screen" looks for it.
 */
for (const [rel, href, type] of [
  ["manifest", "/manifest.webmanifest", undefined],
  ["icon", "/icon-192.png", "image/png"],
  // iOS ignores the manifest's icons and installs with this one.
  ["apple-touch-icon", "/apple-touch-icon.png", undefined],
] as const) {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  if (type) link.type = type;
  document.head.appendChild(link);
}

/**
 * Register the worker that makes the app open without the server.
 *
 * Production only: in development Bun serves modules over its own hot-reload
 * channel, and a cache-first worker in front of that means edits stop
 * appearing. Registration is deferred to `load` so it never competes with the
 * first render for bandwidth.
 */
if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      // A failed registration costs offline support, nothing else, so it is
      // logged rather than surfaced.
      console.warn("[omega] service worker registration failed:", error);
    });
  });
}
