import React from "react";
import { renderToString } from "react-dom/server";
/**
 * Server-side Markdown rendering using Bun.markdown.react() and React SSR.
 *
 * Runs entirely on the server in Bun: parses GitHub Flavored Markdown, performs
 * server-side syntax highlighting via Shiki with pre-baked theme styling,
 * wraps tables in scroll containers, formats task lists with checkboxes,
 * and serializes the complete element tree to HTML with renderToString().
 */
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ["vitesse-dark"],
    langs: [
      "typescript",
      "javascript",
      "tsx",
      "jsx",
      "bash",
      "json",
      "python",
      "html",
      "css",
      "markdown",
      "sql",
      "yaml",
      "rust",
      "go",
      "c",
      "cpp",
      "diff",
    ],
  });
  return highlighterPromise;
}

/**
 * Render Markdown to HTML string with Shiki code highlighting and Mantine classes.
 */
export async function renderMarkdownServer(text: string): Promise<string> {
  if (!text) return "";
  const highlighter = await getHighlighter();

  const element = Bun.markdown.react(
    text,
    {
      pre: ({ language, children }) => {
        const codeText = Array.isArray(children) ? children.join("") : String(children ?? "");
        const lang = language || "text";
        if (lang === "mermaid") {
          return React.createElement("div", {
            className: "omega-mermaid-block",
            "data-code": encodeURIComponent(codeText.trimEnd()),
          });
        }
        let highlighted = "";
        try {
          highlighted = highlighter.codeToHtml(codeText.trimEnd(), {
            lang,
            theme: "vitesse-dark",
          });
        } catch {
          highlighted = `<pre><code>${codeText}</code></pre>`;
        }

        // Wrap pre-rendered Shiki code block with copy action container
        return React.createElement("div", {
          className: "omega-code-block",
          "data-code": codeText.trimEnd(),
          dangerouslySetInnerHTML: { __html: highlighted },
        });
      },
      table: ({ children }) =>
        React.createElement(
          "div",
          { className: "omega-table-wrap" },
          React.createElement("table", { className: "omega-markdown-table" }, children),
        ),
      li: ({ checked, children }) => {
        const isTask = checked !== undefined;
        return React.createElement(
          "li",
          { className: isTask ? "omega-task-list-item" : undefined },
          isTask
            ? React.createElement("input", {
                type: "checkbox",
                className: "omega-task-checkbox",
                defaultChecked: checked,
                disabled: true,
              })
            : null,
          children,
        );
      },
      a: ({ href, title, children }) => {
        const url = String(href ?? "").trim();
        const isAnchor = url.startsWith("#");
        const isExternal =
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:") ||
          url.startsWith("tel:") ||
          url.startsWith("//");

        if (isAnchor) {
          return React.createElement(
            "a",
            { href: url, title, className: "omega-markdown-link omega-markdown-anchor" },
            children,
          );
        }

        if (isExternal) {
          return React.createElement(
            "a",
            {
              href: url,
              title,
              target: "_blank",
              rel: "noreferrer noopener",
              className: "omega-markdown-link omega-markdown-external",
            },
            children,
          );
        }

        // Internal repository link (e.g. "./docs/api.md", "README.md", "src/server/files.ts")
        return React.createElement(
          "a",
          {
            href: `#file=${encodeURIComponent(url.replace(/^\.\//, "").replace(/^file:\/\//, ""))}`,
            title,
            "data-internal-file": url,
            className: "omega-markdown-link omega-markdown-internal",
          },
          children,
        );
      },
      blockquote: ({ children }) =>
        React.createElement("blockquote", { className: "omega-markdown-blockquote" }, children),
    },
    { autolinks: true, tasklists: true, tables: true, headings: { ids: true } },
  );

  return renderToString(element);
}
