/**
 * Client entry.
 *
 * The colour scheme is forced dark: the theme is a dark purple/teal design and
 * has no light variant worth offering.
 */
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/code-highlight/styles.css";
import "./styles.css";
import { CodeHighlightAdapterProvider, createShikiAdapter } from "@mantine/code-highlight";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createHighlighter } from "shiki";

import { configure } from "./api/api.ts";
import { App } from "./App.tsx";
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
  },
});

const container = document.getElementById("root");
if (!container) throw new Error("#root is missing from index.html");

createRoot(container).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <CodeHighlightAdapterProvider adapter={shikiAdapter}>
        <QueryClientProvider client={queryClient}>
          <Notifications position="top-right" limit={3} />
          <App />
        </QueryClientProvider>
      </CodeHighlightAdapterProvider>
    </MantineProvider>
  </StrictMode>,
);
