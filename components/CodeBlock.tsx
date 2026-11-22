"use client";

import { Component, type ComponentProps, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type ExtraProps } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { PluggableList } from "unified";
import { Copy } from "lucide-react";
import { useTheme } from "next-themes";

const LANGUAGE_ALIAS: Record<string, string> = {
  py: "python",
  js: "javascript",
  ts: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  htm: "html",
  "c++": "cpp",
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/** 只统计行首围栏。流式输出数量为奇数时补上结束符，避免未闭合的 ``` 把后面的正文全部吞进代码。 */
export function closeDanglingFence(markdown: string) {
  let fenceCount = 0;
  for (const line of markdown.split("\n")) {
    if (/^\s{0,3}```/.test(line)) fenceCount += 1;
  }
  if (fenceCount % 2 === 0) return { text: markdown, incomplete: false };
  return { text: `${markdown.replace(/\s*$/, "")}\n\`\`\`\n`, incomplete: true };
}

function rehypeMarkIncomplete(incomplete: boolean) {
  return () => (tree: HastNode) => {
    if (!incomplete) return;
    const found: { node: HastNode | null } = { node: null };
    const walk = (node: HastNode, parent?: HastNode) => {
      if (node.type === "element" && node.tagName === "code" && parent?.tagName === "pre") {
        found.node = node;
      }
      for (const child of node.children ?? []) walk(child, node);
    };
    walk(tree);
    if (!found.node) return;
    found.node.properties = { ...(found.node.properties ?? {}), "data-incomplete": "true" };
  };
}

function PlainCode({ code, dark }: { code: string; dark: boolean }) {
  return (
    <pre
      className={`m-0 overflow-x-auto px-4 py-3 font-mono text-[0.8125rem] leading-6 whitespace-pre ${
        dark ? "text-[#d4d4d4]" : "text-gray-800"
      }`}
    >
      <code>{code}</code>
    </pre>
  );
}

function HighlightedCode({ language, code, dark }: { language: string; code: string; dark: boolean }) {
  const prismLanguage = LANGUAGE_ALIAS[language] ?? language;
  return (
    <SyntaxHighlighter
      language={prismLanguage || undefined}
      style={dark ? vscDarkPlus : oneLight}
      PreTag="div"
      customStyle={{
        margin: 0,
        padding: "0.9rem 1rem",
        background: "transparent",
        fontSize: "0.8125rem",
        lineHeight: 1.6,
        overflowX: "auto",
      }}
      codeTagProps={{
        style: {
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        },
      }}
      wrapLongLines={false}
    >
      {code}
    </SyntaxHighlighter>
  );
}

class HighlightBoundary extends Component<
  { language: string; code: string; dark: boolean },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidUpdate(previous: { language: string }) {
    if (previous.language !== this.props.language && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) return <PlainCode code={this.props.code} dark={this.props.dark} />;
    return <HighlightedCode language={this.props.language} code={this.props.code} dark={this.props.dark} />;
  }
}

export function CodeBlock({
  language,
  code,
  incomplete = false,
  className,
  children,
  ...rest
}: {
  language?: string;
  code?: string;
  incomplete?: boolean;
} & ComponentProps<"code"> & ExtraProps) {
  const record = rest as { "data-incomplete"?: string; dataIncomplete?: string };
  const source = code ?? String(children ?? "");
  const normalized = source.replace(/\n$/, "");
  const detected = (language || /language-([\w#+.-]+)/.exec(className ?? "")?.[1] || "").toLowerCase();
  const isIncomplete =
    incomplete || record["data-incomplete"] === "true" || record.dataIncomplete === "true";
  const block = Boolean(detected) || isIncomplete || source.includes("\n");
  const { resolvedTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const label = (detected || "text").toLowerCase();
  const dark = resolvedTheme === undefined ? true : resolvedTheme === "dark";

  useEffect(() => {
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(normalized);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }

  if (!block) {
    return (
      <code>{children}</code>
    );
  }

  return (
    <div
      className={`not-prose my-3 w-full max-w-full min-w-0 overflow-hidden rounded-xl border text-left ${
        dark
          ? "border-transparent bg-[#1e1e1e] text-gray-300 dark:border-none dark:bg-[#1e1e1e] dark:text-gray-300"
          : "border-gray-200 bg-[#f8f9fa] text-gray-700 dark:border-none dark:bg-[#1e1e1e] dark:text-gray-300"
      }`}
    >
      <div
        className={`flex items-center justify-between px-3 py-1.5 text-xs ${
          dark ? "bg-[#2d2d2d] text-gray-300" : "bg-[#e9ecef] text-gray-700 dark:bg-[#2d2d2d] dark:text-gray-300"
        }`}
      >
        <span className="font-medium">{label}</span>
        <button
          type="button"
          onClick={copyCode}
          aria-label={copied ? "已复制" : "复制代码"}
          className="inline-flex h-6 items-center transition-colors hover:opacity-70"
        >
          {copied ? <span className="text-emerald-600 dark:text-emerald-300">已复制</span> : <Copy className="size-3.5" />}
        </button>
      </div>
      <div className="overflow-x-auto">
        {isIncomplete ? (
          <PlainCode code={normalized} dark={dark} />
        ) : (
          <HighlightBoundary language={label} code={normalized} dark={dark} />
        )}
      </div>
    </div>
  );
}

export function MarkdownContent({
  text,
  rehypePlugins = [],
  unwrapParagraph = false,
}: {
  text: string;
  rehypePlugins?: PluggableList;
  unwrapParagraph?: boolean;
}) {
  const prepared = closeDanglingFence(text);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeMarkIncomplete(prepared.incomplete), ...rehypePlugins]}
      components={{
        pre({ children }) {
          return <>{children}</>;
        },
        code: CodeBlock,
        ...(unwrapParagraph ? { p: ({ children }) => <>{children}</> } : {}),
      }}
    >
      {prepared.text}
    </ReactMarkdown>
  );
}
