/**
 * Markdown rendering with server-side React SSR (Bun.markdown.react + Shiki).
 *
 * The server performs GitHub Flavored Markdown parsing, syntax highlighting,
 * and element composition in Bun, returning pre-rendered HTML. The client
 * caches results by content hash and injects them directly, with a delegated
 * click handler for code block copying.
 */
import { Box, Typography } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import React, { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { renderMarkdown } from "../api/api.ts";
import { MermaidChart } from "../components/MermaidChart.tsx";
import { copyText } from "./clipboard.ts";
/** In-memory cache so re-rendering a settled transcript costs no requests. */
const cache = new Map<string, string>();

/** Parse and render server-rendered HTML directly. */
const MERMAID_REGEX = /<div class="omega-mermaid-block" data-code="([^"]*)"><\/div>/g;

/**
 * Resolve a repo-relative link href against the file it appears in.
 *
 * Markdown links are written relative to their own file, not to the
 * workspace root, so `[x](../arch.md)` inside `docs/guide.md` means
 * `arch.md`, not `docs/../arch.md` left unresolved. `basePath` is the
 * currently open file; its directory is the resolution root.
 */
function resolveRepoPath(href: string, basePath: string | undefined): string {
  let clean = href.replace(/^\.\//, "");
  if (clean.startsWith("/")) return clean.slice(1);
  if (!basePath) return clean;

  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  const segments = baseDir ? baseDir.split("/") : [];
  for (const part of clean.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  return segments.join("/");
}

/** Navigate the file viewer to a repo-relative path via the URL hash. */
function openInternalFile(path: string): void {
  window.location.hash = `file=${encodeURIComponent(path)}`;
}

export function RenderedHtml({
  html,
  className,
  baseFilePath,
}: {
  html: string;
  className?: string;
  /** The file this markdown was rendered from, for resolving relative links. */
  baseFilePath?: string;
}): ReactNode {
  const handleClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;

      // Internal repo links navigate the file viewer instead of the browser.
      const internalLink = target.closest("a[data-internal-file]") as HTMLAnchorElement | null;
      if (internalLink) {
        event.preventDefault();
        const rawHref = internalLink.getAttribute("data-internal-file") ?? "";
        // Drop a trailing "#heading" fragment; the file viewer has no anchor scroll.
        const [pathPart] = rawHref.split("#");
        const resolved = resolveRepoPath(pathPart ?? rawHref, baseFilePath);
        if (resolved) openInternalFile(resolved);
        return;
      }

      // Check if clicked inside a code block to copy
      const codeBlock = target.closest(".omega-code-block") as HTMLElement | null;
      if (codeBlock && (target.tagName.toLowerCase() === "pre" || target.closest("pre"))) {
        const code = codeBlock.getAttribute("data-code");
        if (code) {
          const ok = await copyText(code);
          if (ok) {
            notifications.show({
              color: "cyan",
              title: "Copied code",
              message: "Code snippet copied to clipboard.",
              autoClose: 2000,
            });
          }
        }
      }
    },
    [baseFilePath],
  );

  const segments = useMemo(() => {
    if (!html || !html.includes("omega-mermaid-block")) return null;
    const parts: Array<{ type: "html" | "mermaid"; content: string; key: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const regex = new RegExp(MERMAID_REGEX.source, "g");

    while ((match = regex.exec(html)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: "html",
          content: html.slice(lastIndex, match.index),
          key: `html-${lastIndex}`,
        });
      }
      try {
        const decoded = decodeURIComponent(match[1] ?? "");
        parts.push({
          type: "mermaid",
          content: decoded,
          key: `mermaid-${match.index}`,
        });
      } catch {
        parts.push({
          type: "html",
          content: match[0],
          key: `html-err-${match.index}`,
        });
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < html.length) {
      parts.push({
        type: "html",
        content: html.slice(lastIndex),
        key: `html-${lastIndex}`,
      });
    }

    return parts;
  }, [html]);

  if (!html) return null;

  if (segments) {
    return (
      <div className={className ? `omega-markdown ${className}` : "omega-markdown"}>
        {segments.map(seg => {
          if (seg.type === "mermaid") {
            return (
              <Box key={seg.key} my="md">
                <MermaidChart code={seg.content} height={360} />
              </Box>
            );
          }
          return (
            <Typography
              key={seg.key}
              dangerouslySetInnerHTML={{ __html: seg.content }}
              onClick={handleClick}
            />
          );
        })}
      </div>
    );
  }

  return (
    <Typography
      className={className ? `omega-markdown ${className}` : "omega-markdown"}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}

export function useRenderedHtml(html: string): ReactNode {
  return <RenderedHtml html={html} />;
}

/**
 * Coalesce every render this tick into one request.
 *
 * A settled transcript mounts hundreds of parts in a single commit, and one
 * request per part is hundreds of round trips for work the server finishes in
 * microseconds. The queue collects the texts each commit asks for, flushes
 * them as one batch, and hands every waiter its own entry back.
 */
const waiting = new Map<string, Array<(html: string) => void>>();
let flushHandle: number | undefined;

/** Largest batch sent in one request, so a huge transcript stays chunked. */
const BATCH_LIMIT = 250;

function flush(): void {
  flushHandle = undefined;
  const texts = [...waiting.keys()].slice(0, BATCH_LIMIT);
  if (texts.length === 0) return;
  const claimed = texts.map(text => {
    const resolvers = waiting.get(text) ?? [];
    waiting.delete(text);
    return { text, resolvers };
  });
  // Anything past the limit waits for the next flush rather than being lost.
  if (waiting.size > 0) schedule();

  void renderMarkdown({ body: { texts } })
    .then(result => {
      for (const [index, entry] of claimed.entries()) {
        const html = result.html[index] ?? "";
        cache.set(entry.text, html);
        for (const resolve of entry.resolvers) resolve(html);
      }
    })
    .catch(() => {
      // A failed batch leaves the raw text on screen; nothing is cached, so
      // the next mount retries.
      for (const entry of claimed) {
        for (const resolve of entry.resolvers) resolve("");
      }
    });
}

function schedule(): void {
  if (flushHandle !== undefined) return;
  // A frame, not a microtask: React commits its effects across several
  // microtasks, and batching across the whole frame is what collapses a
  // transcript's parts into one request.
  flushHandle = requestAnimationFrame(flush);
}

/** Queue one text for the next batch. */
function renderQueued(text: string): Promise<string> {
  const cached = cache.get(text);
  if (cached !== undefined) return Promise.resolve(cached);
  return new Promise<string>(resolve => {
    const resolvers = waiting.get(text);
    if (resolvers) resolvers.push(resolve);
    else waiting.set(text, [resolve]);
    schedule();
  });
}

/**
 * Render markdown through the server.
 *
 * Streaming text without a server render yet falls back to raw text with line
 * breaks preserved, so the turn stays readable token by token.
 */
export function Markdown({ text, baseFilePath }: { text: string; baseFilePath?: string }): ReactNode {
  const [html, setHtml] = useState(() => cache.get(text) ?? "");

  useEffect(() => {
    const cached = cache.get(text);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    let active = true;
    void renderQueued(text).then(rendered => {
      if (active) setHtml(rendered);
    });
    return () => {
      active = false;
    };
  }, [text]);

  if (!html) {
    return <div className="omega-markdown-raw">{text}</div>;
  }

  return <RenderedHtml html={html} baseFilePath={baseFilePath} />;
}
