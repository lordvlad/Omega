/**
 * Markdown rendering, split across the two runtimes that can each do half.
 *
 * `Bun.markdown` is a Bun API with no browser equivalent, so the server
 * renders the markdown and this module renders the resulting HTML. Fenced code
 * is the exception: `Bun.markdown.html` emits a plain
 * `<pre><code class="language-ts">`, which carries no highlighting, so those
 * nodes are replaced with Mantine's `CodeHighlight` on the way through. The
 * result is one pass: Bun owns the markdown, Mantine owns the code.
 */
import { CodeHighlight } from "@mantine/code-highlight";
import { ActionIcon, Box, Tooltip, Typography } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { createElement, Fragment, type ReactNode, useEffect, useMemo, useState } from "react";

import { renderMarkdown } from "../api/api.ts";
import { copyText } from "./clipboard.ts";

/** Attributes worth carrying from the parsed HTML onto the React element. */
const KEPT_ATTRIBUTES: Record<string, string> = {
  href: "href",
  src: "src",
  alt: "alt",
  title: "title",
  id: "id",
  start: "start",
};

/** Tags that must not survive into the React tree. */
const DROPPED_TAGS: Record<string, true> = { script: true, style: true, iframe: true, object: true };

/**
 * A fenced block, with a copy control that works off a secure origin.
 *
 * Mantine's own copy button goes through `navigator.clipboard`, which does
 * not exist when omega is reached over the LAN, so on a phone it is a button
 * that does nothing. Code is the most copied thing in a transcript, so it
 * gets the same fallback the message menu uses rather than the stock one.
 */
function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    const ok = await copyText(code);
    setCopied(ok);
    if (!ok) {
      notifications.show({
        color: "red",
        title: "Could not copy",
        message: "The browser refused the clipboard. Select the code and copy it by hand.",
      });
      return;
    }
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Box style={{ position: "relative" }} my="sm">
      <CodeHighlight code={code} language={language} withCopyButton={false} />
      <Tooltip label={copied ? "Copied" : "Copy"} position="left">
        <ActionIcon
          onClick={() => void copy()}
          variant="subtle"
          color="gray"
          size="sm"
          aria-label="Copy code"
          style={{ position: "absolute", top: 6, right: 6, zIndex: 1 }}
        >
          {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
        </ActionIcon>
      </Tooltip>
    </Box>
  );
}

/** Convert one parsed DOM node into React elements. */
function convert(node: Node, keyPath: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  if (DROPPED_TAGS[tag]) return null;

  // A fenced block is `<pre><code class="language-x">`; hand it to Mantine
  // with the language it declared.
  if (tag === "pre") {
    const code = element.firstElementChild;
    if (code && code.tagName.toLowerCase() === "code") {
      const declared = /language-([\w+-]+)/u.exec(code.className ?? "");
      return <CodeBlock key={keyPath} code={code.textContent ?? ""} language={declared?.[1] ?? "text"} />;
    }
  }

  const props: Record<string, unknown> = { key: keyPath };
  for (const [attribute, propName] of Object.entries(KEPT_ATTRIBUTES)) {
    const value = element.getAttribute(attribute);
    if (value !== null) props[propName] = value;
  }
  // Inline code keeps its class so the theme can style it.
  if (tag === "code") props.className = "omega-inline-code";
  if (tag === "a") {
    props.target = "_blank";
    props.rel = "noreferrer noopener";
  }

  const children = [...element.childNodes]
    .map((child, index) => convert(child, `${keyPath}.${index}`))
    .filter(child => child !== null && child !== "");

  if (children.length === 0) return createElement(tag, props);
  return createElement(tag, props, children);
}

/** Parse server-rendered HTML into a React tree. */
export function useRenderedHtml(html: string): ReactNode {
  return useMemo(() => {
    if (!html) return null;
    // `DOMParser` never executes scripts, and `DROPPED_TAGS` removes them
    // anyway, so agent-authored markdown cannot inject behaviour here.
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return (
      <Fragment>{[...parsed.body.childNodes].map((child, index) => convert(child, `n${index}`))}</Fragment>
    );
  }, [html]);
}

/** In-memory cache so re-rendering a settled transcript costs no requests. */
const cache = new Map<string, string>();

/**
 * Render markdown through the server.
 *
 * Text arrives token by token during a turn, so the request is debounced and
 * the last good HTML is kept on screen while the next one is in flight —
 * otherwise a streaming answer would flicker between rendered and blank.
 */
export function Markdown({ text }: { text: string }): ReactNode {
  const [html, setHtml] = useState(() => cache.get(text) ?? "");

  useEffect(() => {
    const hit = cache.get(text);
    if (hit !== undefined) {
      setHtml(hit);
      return;
    }
    if (!text.trim()) {
      setHtml("");
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void renderMarkdown({ body: { text } })
        .then(result => {
          cache.set(text, result.html);
          if (!cancelled) setHtml(result.html);
        })
        .catch(() => {
          // Rendering is presentation; a failed round trip should not blank
          // the message. Fall back to the source text.
          if (!cancelled) setHtml("");
        });
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [text]);

  const tree = useRenderedHtml(html);
  if (!html) {
    // Pre-render (or failed render): show the markdown source rather than a
    // gap, so streaming text is readable before its first render lands.
    return <div className="omega-markdown-raw">{text}</div>;
  }
  return <Typography className="omega-markdown">{tree}</Typography>;
}
