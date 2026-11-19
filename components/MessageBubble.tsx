"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Copy } from "lucide-react";

export type MessageRole = "user" | "assistant";

/** 把 \( \) / \[ \] 转成 $，并转义公式外的变量下划线，避免 I_D 被 Markdown 当成斜体。 */
function normalizeLatexDelimiters(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : escapePlainTextUnderscores(part)))
    .join("");
}

const katexOptions = {
  throwOnError: false,
  errorColor: "currentColor",
  strict: "ignore",
} as const;

function escapePlainTextUnderscores(text: string) {
  const withDollars = text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) => `$${expression}$`);
  const balanced = escapeUnbalancedDollars(withDollars);

  return balanced
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/([A-Za-z0-9])_([A-Za-z0-9])/g, "$1\\_$2"),
    )
    .join("");
}

function escapeUnbalancedDollars(text: string) {
  let output = "";
  let index = 0;

  while (index < text.length) {
    if (text[index] !== "$") {
      output += text[index];
      index += 1;
      continue;
    }

    if (text.startsWith("$$", index)) {
      const close = text.indexOf("$$", index + 2);
      const span = close === -1 ? "" : text.slice(index + 2, close);
      if (close === -1 || /\n\s{0,3}#{1,6}\s/.test(span)) {
        output += "\\$\\$";
        index += 2;
        continue;
      }
      output += text.slice(index, close + 2);
      index = close + 2;
      continue;
    }

    const close = findClosingSingleDollar(text, index + 1);
    const span = close === -1 ? "" : text.slice(index + 1, close);
    if (close === -1 || /\n\s*\n/.test(span) || /\n\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+\.\s)/.test(span)) {
      output += "\\$";
      index += 1;
      continue;
    }
    output += text.slice(index, close + 1);
    index = close + 1;
  }

  return output;
}

function findClosingSingleDollar(text: string, from: number) {
  for (let index = from; index < text.length; index += 1) {
    if (text[index] !== "$" || text[index + 1] === "$" || text[index - 1] === "$") continue;
    return index;
  }
  return -1;
}

type HastNode = {
  type: string;
  tagName?: string;
  properties?: { className?: string | string[]; ariaHidden?: string };
  children?: HastNode[];
  value?: string;
};

function hastClassName(node: HastNode) {
  const value = node.properties?.className;
  if (Array.isArray(value)) return value.join(" ");
  return value ?? "";
}

/** 把闪烁光标插到最后一个可书写位置，避免掉进代码块或公式内部。 */
function rehypeChatCaret() {
  return (tree: HastNode) => {
    const parent = findCaretParent(tree) ?? tree;
    parent.children = parent.children ?? [];
    parent.children.push({
      type: "element",
      tagName: "span",
      properties: { className: ["chat-caret"], ariaHidden: "true" },
      children: [],
    });
  };
}

function findCaretParent(node: HastNode): HastNode | null {
  const children = node.children;
  if (!children?.length) return null;

  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index];
    if (child.type === "text") {
      if (child.value?.trim()) return node;
      continue;
    }
    if (child.type !== "element") continue;

    const tag = child.tagName ?? "";
    if (tag === "pre" || tag === "code" || tag === "hr" || hastClassName(child).includes("katex") || !child.children?.length) {
      return node;
    }

    const deeper = findCaretParent(child);
    if (deeper) return deeper;
  }

  return null;
}

export function MessageBubble({
  role,
  content,
  streaming = false,
}: {
  role: MessageRole;
  content: string;
  streaming?: boolean;
}) {
  const mine = role === "user";
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    };
  }, []);

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div
      className={
        mine
          ? "ml-auto w-fit min-w-0 max-w-[80%] rounded-2xl rounded-tr-sm bg-indigo-600 px-4 py-2.5 text-sm leading-6 break-words text-white"
          : "relative mr-auto w-fit min-w-0 max-w-[80%] rounded-2xl rounded-tl-sm bg-gray-100 px-4 pt-2.5 pb-8 text-sm leading-6 break-words text-gray-800 dark:bg-slate-800 dark:text-slate-200"
      }
    >
      {mine ? (
        <p className="whitespace-pre-wrap break-words">{content}</p>
      ) : (
        <div className="prose prose-slate max-w-none text-sm break-words text-gray-800 prose-p:my-1 dark:prose-invert dark:text-slate-200">
          <ReactMarkdown
            remarkPlugins={[remarkMath, remarkGfm]}
            rehypePlugins={
              streaming ? [[rehypeKatex, katexOptions], rehypeChatCaret] : [[rehypeKatex, katexOptions]]
            }
          >
            {normalizeLatexDelimiters(content)}
          </ReactMarkdown>
        </div>
      )}
      {mine || streaming || !content ? null : (
        <button
          type="button"
          aria-label="复制"
          onClick={copyReply}
          className="absolute right-2 bottom-1.5 flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-indigo-600 dark:hover:bg-slate-700 dark:hover:text-indigo-300"
        >
          <Copy className="size-3.5" />
        </button>
      )}
      {copied ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
          已复制
        </div>
      ) : null}
    </div>
  );
}
