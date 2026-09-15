/**
 * Markdown rendering with server-side React SSR (Bun.markdown.react + Shiki).
 *
 * The server performs GitHub Flavored Markdown parsing, syntax highlighting,
 * and element composition in Bun, returning pre-rendered HTML. The client
 * caches results by content hash and injects them directly, with a delegated
 * click handler for code block copying.
 */
import { Typography } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import React, { type ReactNode, useCallback, useEffect, useState } from "react";

import { renderMarkdown } from "../api/api.ts";
import { copyText } from "./clipboard.ts";

/** In-memory cache so re-rendering a settled transcript costs no requests. */
const cache = new Map<string, string>();

/** Parse and render server-rendered HTML directly. */
export function RenderedHtml({ html, className }: { html: string; className?: string }): ReactNode {
  const handleClick = useCallback(async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
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
  }, []);

  if (!html) return null;
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
 * Render markdown through the server.
 *
 * Streaming text without a server render yet falls back to raw text with line
 * breaks preserved, so the turn stays readable token by token.
 */
export function Markdown({ text }: { text: string }): ReactNode {
  const [html, setHtml] = useState(() => cache.get(text) ?? "");

  useEffect(() => {
    const cached = cache.get(text);
    if (cached !== undefined) {
      setHtml(cached);
      return;
    }
    let active = true;
    void renderMarkdown({ body: { text } })
      .then(result => {
        if (!active) return;
        cache.set(text, result.html);
        setHtml(result.html);
      })
      .catch(() => {
        if (!active) return;
        setHtml("");
      });
    return () => {
      active = false;
    };
  }, [text]);

  if (!html) {
    return <div className="omega-markdown-raw">{text}</div>;
  }

  return <RenderedHtml html={html} />;
}
