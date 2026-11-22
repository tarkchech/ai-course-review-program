"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { Group, Panel, Separator } from "react-resizable-panels";
import rehypeKatex from "rehype-katex";
import { FileText, Loader2, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen, Send, Sparkles, Star } from "lucide-react";

import { MarkdownContent } from "@/components/CodeBlock";
import { FileUpload } from "@/components/FileUpload";
import { HistoryList } from "@/components/HistoryList";
import { MessageList } from "@/components/MessageList";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useHistory } from "@/hooks/use-history";
import { createHistoryRecord } from "@/lib/history";
import { extractTextFromPDF } from "@/app/utils/pdf";
import { extractTextFromPPTX } from "@/app/utils/pptx";

type ReviewMode = "outline" | "quiz";
type ReviewStyle = "normal" | "expert" | "exam";
type UploadKind = "pdf" | "pptx";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface QuizQuestion {
  type: "choice" | "fill_blank" | "calculation";
  isCoding: boolean;
  question: string;
  options: string[] | null;
  answer: string;
  explanation: string;
}

const QUIZ_TYPE_LABEL = {
  choice: "选择题",
  fill_blank: "填空题",
  calculation: "计算/简答",
} as const;

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

const ACCEPT =
  ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

function uploadKind(file: File): UploadKind | "ppt" | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".ppt") && !name.endsWith(".pptx")) return "ppt";
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    name.endsWith(".pptx") ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  return null;
}

type HastNode = {
  type: string;
  tagName?: string;
  properties?: { className?: string | string[]; ariaHidden?: string };
  children?: HastNode[];
  value?: string;
};

const CURSOR_LEAF_TAGS = new Set(["pre", "code", "hr"]);

function hastClassName(node: HastNode) {
  const value = node.properties?.className;
  if (Array.isArray(value)) return value.join(" ");
  return value ?? "";
}

/** 把闪烁光标插进最后一个可书写位置，代码块和公式后面则紧跟其后。 */
function rehypeStreamingCursor() {
  return (tree: HastNode) => {
    const parent = findCursorParent(tree);
    parent?.children?.push({
      type: "element",
      tagName: "span",
      properties: { className: ["streaming-cursor"], ariaHidden: "true" },
      children: [],
    });
  };
}

function findCursorParent(node: HastNode): HastNode | null {
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
    if (
      CURSOR_LEAF_TAGS.has(tag) ||
      hastClassName(child).includes("katex") ||
      !child.children?.length
    ) {
      return node;
    }

    const deeper = findCursorParent(child);
    if (deeper) return deeper;
  }

  return null;
}

/** rehype-katex 会先强制 throwOnError: true，失败后再用 false 重绘。errorColor 决定失败时源码的颜色，默认是红色。 */
const katexOptions = {
  throwOnError: false,
  errorColor: "currentColor",
  strict: "ignore" as const,
};
const katexPlugin: [typeof rehypeKatex, typeof katexOptions] = [rehypeKatex, katexOptions];

/** 把 \( \) / \[ \] 转成 $，隔开未闭合公式，并转义公式外的变量下划线。 */
function normalizeLatexDelimiters(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : escapePlainTextUnderscores(part)))
    .join("");
}

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

/** 未闭合的 $ 如果一路配到后文的标题或列表，会把排版整段吞进公式。这种开头改成普通文本。 */
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

function parseQuizQuestions(data: unknown): QuizQuestion[] {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("测验结果不是有效的题目列表");
  }

  return data.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`第 ${index + 1} 题格式不正确`);
    }
    const record = item as Record<string, unknown>;
    const question = typeof record.question === "string" ? record.question.trim() : "";
    const explanation = typeof record.explanation === "string" ? record.explanation.trim() : "";
    const type =
      record.type === "choice" || record.type === "fill_blank" || record.type === "calculation"
        ? record.type
        : "choice";
    const options =
      type === "choice" && Array.isArray(record.options)
        ? record.options.filter((option): option is string => typeof option === "string" && option.trim() !== "")
        : null;
    const answer = typeof record.answer === "string" ? record.answer.trim() : "";

    if (!question || !answer || (type === "choice" && (!options || options.length === 0))) {
      throw new Error(`第 ${index + 1} 题缺少 question、options 或 answer`);
    }

    return { type, isCoding: record.isCoding === true, question, options, answer, explanation };
  });
}

function optionButtonClass(letter: string, selected: string | undefined, answer: string) {
  const base =
    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all duration-300 disabled:cursor-default disabled:opacity-100 [&_.prose]:text-current!";
  if (!selected) {
    return `${base} border-slate-300 bg-white text-slate-900 hover:border-indigo-300 hover:bg-indigo-50/70 active:scale-[0.99] dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-100 dark:hover:bg-indigo-950/40`;
  }
  if (letter === answer) {
    return `${base} border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400`;
  }
  if (letter === selected) {
    return `${base} border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400`;
  }
  return `${base} border-slate-300 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400`;
}

function letterBadgeClass(letter: string, selected: string | undefined, answer: string) {
  const base =
    "flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-colors duration-300";
  if (!selected) return `${base} bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300`;
  if (letter === answer) return `${base} bg-emerald-500 text-white`;
  if (letter === selected) return `${base} bg-red-500 text-white`;
  return `${base} bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400`;
}

function TutorChat({
  messages,
  draft,
  loading,
  onDraftChange,
  onSend,
}: {
  messages: ChatMessage[];
  draft: string;
  loading: boolean;
  onDraftChange: (value: string) => void;
  onSend: () => void;
}) {
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !loading && draft.trim().length > 0;

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 128)}px`;
  }, [draft]);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-0 dark:border-slate-800 dark:bg-slate-900 dark:shadow-lg">
      <div className="shrink-0 border-b border-slate-300 px-4 py-3 dark:border-slate-800">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">AI 助教</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">针对当前课件继续追问</p>
      </div>
      <MessageList messages={messages} loading={loading} />
      <form
        className="shrink-0 border-t border-slate-300 p-3 dark:border-slate-800"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSend();
        }}
      >
        <div className="flex items-end gap-1 rounded-2xl border border-slate-300 bg-slate-100 py-1 pr-1 pl-3 transition-colors focus-within:border-indigo-400 dark:border-slate-700 dark:bg-slate-800 dark:focus-within:border-indigo-500">
          <textarea
            ref={composerRef}
            value={draft}
            rows={1}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              if (canSend) onSend();
            }}
            placeholder="输入你的问题"
            className="max-h-32 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={!canSend}
            aria-label="发送"
            className="mb-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white transition-colors hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
          >
            <Send className="size-4" />
          </button>
        </div>
      </form>
    </Card>
  );
}

function QuizMarkdown({ text, inline = false }: { text: string; inline?: boolean }) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      className={
        inline
          ? "prose prose-slate inline max-w-none text-sm prose-p:my-0 dark:prose-invert"
          : "prose prose-slate max-w-none overflow-x-auto text-sm prose-p:my-1 prose-headings:my-2 dark:prose-invert"
      }
    >
      <MarkdownContent
        text={normalizeLatexDelimiters(text)}
        rehypePlugins={[katexPlugin]}
        unwrapParagraph={inline}
      />
    </Tag>
  );
}

function AnswerReveal({ question, revealed }: { question: QuizQuestion; revealed: boolean }) {
  return (
    <div
      className={`grid transition-all duration-500 ease-out ${
        revealed ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      }`}
    >
      <div className="overflow-hidden">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
          <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">标准答案</p>
          <QuizMarkdown text={question.answer} />
          <div className="mt-3 border-t border-emerald-200/80 pt-3 dark:border-emerald-800/80">
            <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">解析</p>
            <QuizMarkdown text={question.explanation || "这道题没有附加解析。"} />
          </div>
          {question.type === "calculation" ? (
            <p className="mt-3 text-xs text-emerald-700/80 dark:text-emerald-300/80">
              💡 您可以在上方草稿区继续修改推导
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function QuizBoard({
  questions,
  selectedAnswers,
  revealedAnswers,
  onSelect,
  onReveal,
}: {
  questions: QuizQuestion[];
  selectedAnswers: Record<number, string>;
  revealedAnswers: Record<number, boolean>;
  onSelect: (index: number, letter: string) => void;
  onReveal: (index: number) => void;
}) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const checked = Object.keys(revealedAnswers).length;
  const correct = questions.filter(
    (question, index) => question.type === "choice" && selectedAnswers[index] === question.answer,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">互动刷题</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          已核对 {checked}/{questions.length}
          {checked > 0 ? ` · 选择题答对 ${correct}` : ""}
        </p>
      </div>
      {questions.map((question, index) => {
        const selected = selectedAnswers[index];
        const revealed = Boolean(revealedAnswers[index]);
        const fieldClass = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition-all duration-300 ${
          revealed
            ? "border-slate-300 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-400"
            : "border-slate-300 bg-slate-100 text-slate-900 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-900"
        }`;
        return (
          <article
            key={`${index}-${question.question}`}
            className="min-w-0 rounded-2xl border border-slate-300 bg-slate-100 p-4 shadow-sm transition-shadow duration-300 hover:shadow-md sm:p-5 dark:border-slate-800 dark:bg-slate-800/70"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-indigo-500">{QUIZ_TYPE_LABEL[question.type]}</p>
                <div className="prose prose-slate dark:prose-invert mt-1 min-w-0 max-w-none overflow-x-auto text-sm font-medium leading-6 text-slate-900 dark:text-slate-100">
                  <QuizMarkdown text={question.question} />
                </div>
              </div>
            </div>
            {question.type === "choice" ? (
              <div className="mt-4 grid gap-2">
                {(question.options ?? []).map((option, optionIndex) => {
                  const letter = OPTION_LETTERS[optionIndex] ?? String(optionIndex + 1);
                  return (
                    <button
                      key={letter}
                      type="button"
                      disabled={revealed}
                      onClick={() => onSelect(index, letter)}
                      className={optionButtonClass(letter, selected, question.answer)}
                    >
                      <span className={letterBadgeClass(letter, selected, question.answer)}>{letter}</span>
                      <span className="min-w-0 flex-1">
                        <QuizMarkdown text={option} inline />
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-4">
                {question.type === "fill_blank" ? (
                  <input
                    value={drafts[index] ?? ""}
                    readOnly={revealed}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [index]: event.target.value }))
                    }
                    placeholder="在这里填写答案"
                    className={fieldClass}
                  />
                ) : question.isCoding ? (
                  <div
                    className={`overflow-hidden rounded-xl border ${
                      dark
                        ? "border-[#3c3c3c] bg-[#1e1e1e]"
                        : "border-gray-200 bg-[#f8f9fa] dark:border-[#3c3c3c] dark:bg-[#1e1e1e]"
                    }`}
                  >
                    <div
                      className={`flex items-center gap-2 border-b px-3 py-2 ${
                        dark
                          ? "border-[#3c3c3c] bg-[#2d2d2d] text-gray-300"
                          : "border-gray-200 bg-[#e9ecef] text-gray-700 dark:border-[#3c3c3c] dark:bg-[#2d2d2d] dark:text-gray-300"
                      }`}
                    >
                      <span className="flex items-center gap-1.5" aria-hidden="true">
                        <span className="size-2.5 rounded-full bg-red-500" />
                        <span className="size-2.5 rounded-full bg-amber-400" />
                        <span className="size-2.5 rounded-full bg-emerald-500" />
                      </span>
                      <span className="text-xs">代码草稿区</span>
                    </div>
                    <textarea
                      value={drafts[index] ?? ""}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [index]: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key !== "Tab") return;
                        event.preventDefault();
                        const target = event.currentTarget;
                        const start = target.selectionStart ?? 0;
                        const end = target.selectionEnd ?? 0;
                        const indent = "    ";
                        const next = `${target.value.slice(0, start)}${indent}${target.value.slice(end)}`;
                        setDrafts((current) => ({ ...current, [index]: next }));
                        requestAnimationFrame(() => {
                          target.selectionStart = start + indent.length;
                          target.selectionEnd = start + indent.length;
                        });
                      }}
                      placeholder="可以在这里编写代码草稿"
                      spellCheck={false}
                      className={`min-h-[200px] w-full resize-y border-0 px-4 py-3 font-mono text-sm outline-none focus:outline-none ${
                        dark
                          ? "bg-[#1e1e1e] text-white placeholder:text-slate-500"
                          : "bg-[#f8f9fa] text-black placeholder:text-slate-400 dark:bg-[#1e1e1e] dark:text-white dark:placeholder:text-slate-500"
                      }`}
                    />
                  </div>
                ) : (
                  <textarea
                    value={drafts[index] ?? ""}
                    rows={5}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [index]: event.target.value }))
                    }
                    placeholder="可以在这里打草稿，不必填写"
                    className="min-h-32 w-full resize-y rounded-xl border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                )}
                {revealed ? null : (
                  <button
                    type="button"
                    onClick={() => onReveal(index)}
                    className="mt-3 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-medium text-indigo-600 transition-all duration-300 hover:bg-indigo-50 dark:border-indigo-800 dark:bg-slate-900 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
                  >
                    {question.type === "fill_blank" ? "核对答案" : "显示解法"}
                  </button>
                )}
              </div>
            )}
            {question.type === "choice" ? (
              <div
                className={`grid transition-all duration-500 ease-out ${
                  revealed ? "mt-3 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="overflow-hidden">
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm leading-6 text-slate-900 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-slate-100">
                    <p className="text-xs font-medium text-indigo-600 dark:text-indigo-300">
                      解析 · 正确答案 <QuizMarkdown text={question.answer} inline />
                    </p>
                    <QuizMarkdown text={question.explanation || "这道题没有附加解析。"} />
                  </div>
                </div>
              </div>
            ) : (
              <AnswerReveal question={question} revealed={revealed} />
            )}
          </article>
        );
      })}
    </div>
  );
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const runId = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState<ReviewMode | null>(null);
  const [outlineResult, setOutlineResult] = useState("");
  const [quizResult, setQuizResult] = useState<QuizQuestion[]>([]);
  const [outlineCount, setOutlineCount] = useState(1);
  const [quizCount, setQuizCount] = useState(1);
  const [outlineRecordId, setOutlineRecordId] = useState<string | null>(null);
  const [quizRecordId, setQuizRecordId] = useState<string | null>(null);
  const { records, addRecord, toggleFavorite, removeRecord, clearRecords } = useHistory();
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const extractedTextRef = useRef("");
  const chatRunId = useRef(0);
  const [mode, setMode] = useState<ReviewMode>("outline");
  const [reviewStyle, setReviewStyle] = useState<ReviewStyle>("normal");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return () => {
      runId.current += 1;
    };
  }, []);

  useEffect(() => {
    const pane = reviewRef.current;
    if (!pane || generating !== "outline" || mode !== "outline" || !stickToBottom.current) return;
    pane.scrollTop = pane.scrollHeight;
  }, [outlineResult, generating, mode]);

  useEffect(() => {
    if (!isFullscreen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsFullscreen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFullscreen]);

  function chooseFile(next: File | null) {
    if (!next) return;
    const kind = uploadKind(next);
    if (kind === "ppt") {
      setNotice("暂不支持旧版 .ppt，请在 PowerPoint 中另存为 .pptx");
      return;
    }
    if (!kind) {
      setNotice("目前只支持 PDF 和 PPTX");
      return;
    }
    setNotice("");
    setFile(next);
    setOutlineResult("");
    setQuizResult([]);
    setOutlineRecordId(null);
    setQuizRecordId(null);
    setOutlineCount(1);
    setQuizCount(1);
    setSelectedAnswers({});
    setRevealedAnswers({});
    setExtractedText("");
    extractedTextRef.current = "";
    resetChat();
  }

  function resetChat() {
    chatRunId.current += 1;
    setMessages([]);
    setChatDraft("");
    setChatLoading(false);
  }

  function clearFile() {
    setFile(null);
    setNotice("");
    if (inputRef.current) inputRef.current.value = "";
  }

  function clearCurrentResult() {
    if (mode === "quiz") {
      setQuizResult([]);
      setSelectedAnswers({});
      setRevealedAnswers({});
      setQuizRecordId(null);
      return;
    }
    setOutlineResult("");
    setOutlineRecordId(null);
  }

  function clearResultForRecord(id: string) {
    if (outlineRecordId === id) {
      setOutlineResult("");
      setOutlineRecordId(null);
    }
    if (quizRecordId === id) {
      setQuizResult([]);
      setSelectedAnswers({});
      setRevealedAnswers({});
      setQuizRecordId(null);
    }
  }

  function deleteHistory(id: string) {
    removeRecord(id);
    clearResultForRecord(id);
  }

  function clearAllHistory() {
    const ids = records.map((record) => record.id);
    clearRecords();
    ids.forEach(clearResultForRecord);
  }

  async function handleStart() {
    if (!file || generating) return;
    if (file.size > 20 * 1024 * 1024) {
      setNotice("文件超过 20MB，请换一份较小的文件");
      return;
    }

    const id = ++runId.current;
    const activeMode = mode;
    const activeStyle = reviewStyle;
    const attemptCount = activeMode === "quiz" ? quizCount : outlineCount;
    const sourceName = file.name;
    const previousOutline = outlineResult;
    stickToBottom.current = true;
    setGenerating(activeMode);
    setNotice("");
    if (activeMode === "outline") {
      setOutlineResult("");
    }

    try {
      const kind = uploadKind(file);
      if (kind !== "pdf" && kind !== "pptx") {
        throw new Error("目前只支持 PDF 和 PPTX");
      }
      const text =
        kind === "pptx" ? await extractTextFromPPTX(file) : await extractTextFromPDF(file);
      if (runId.current !== id) return;
      if (!text.trim()) {
        throw new Error(
          kind === "pptx"
            ? "没有从 PPTX 中提取到文字，可能是纯图片幻灯片"
            : "没有从 PDF 中提取到文本",
        );
      }
      extractedTextRef.current = text;
      setExtractedText(text);

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode: activeMode, attemptCount, reviewStyle: activeStyle }),
      });
      if (runId.current !== id) return;
      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || "生成失败");
      }

      if (activeMode === "quiz") {
        let payload: unknown;
        try {
          payload = await response.json();
        } catch {
          throw new Error("测验结果不是有效的 JSON");
        }
        if (runId.current !== id) return;
        const questions = parseQuizQuestions(payload);
        const record = createHistoryRecord(sourceName, "quiz", JSON.stringify(questions));
        setQuizResult(questions);
        setSelectedAnswers({});
        setRevealedAnswers({});
        addRecord(record);
        setQuizRecordId(record.id);
        setQuizCount((count) => count + 1);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let outlineText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done || runId.current !== id) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          outlineText += chunk;
          setOutlineResult(outlineText);
        }
      }

      const tail = decoder.decode();
      if (tail && runId.current === id) {
        outlineText += tail;
        setOutlineResult(outlineText);
      }
      if (runId.current !== id) return;
      if (outlineText.trim()) {
        const record = createHistoryRecord(sourceName, "outline", outlineText);
        addRecord(record);
        setOutlineRecordId(record.id);
      }
      setOutlineCount((count) => count + 1);
    } catch (error) {
      if (runId.current !== id) return;
      if (activeMode === "outline") setOutlineResult(previousOutline);
      setNotice(error instanceof Error ? error.message : "生成失败");
    } finally {
      if (runId.current === id) setGenerating(null);
    }
  }

  function openHistory(record: { id: string; mode: ReviewMode; content: string }) {
    resetChat();
    setMode(record.mode);
    if (record.mode === "outline") {
      setOutlineResult(record.content);
      setOutlineRecordId(record.id);
      return;
    }

    try {
      const questions = parseQuizQuestions(JSON.parse(record.content));
      setQuizResult(questions);
      setSelectedAnswers({});
      setRevealedAnswers({});
      setQuizRecordId(record.id);
    } catch {
      setNotice("这条测验记录已损坏，无法打开");
    }
  }

  async function sendChat() {
    const text = chatDraft.trim();
    if (!text || chatLoading) return;

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: text };
    const assistantId = crypto.randomUUID();
    const run = chatRunId.current + 1;
    chatRunId.current = run;
    const history = [...messages, userMessage];

    setChatDraft("");
    setChatLoading(true);
    setMessages([...history, { id: assistantId, role: "assistant", content: "" }]);

    const pendingRef = { text: "" };
    let frame = 0;
    const flush = () => {
      frame = 0;
      const chunk = pendingRef.text;
      pendingRef.text = "";
      if (!chunk || chatRunId.current !== run) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: message.content + chunk } : message,
        ),
      );
    };
    const append = (chunk: string) => {
      if (!chunk) return;
      pendingRef.text += chunk;
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const fail = (detail: string) => {
      if (chatRunId.current !== run) return;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId ? { ...message, content: message.content || detail } : message,
        ),
      );
    };

    try {
      const courseText = (extractedTextRef.current || extractedText).trim();
      if (!courseText) {
        throw new Error("请先开始复习，让助教读到课件原文");
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          contextText: courseText,
        }),
      });
      if (!response.ok || !response.body) {
        const detail = (await response.text()).trim();
        const brief =
          !detail || detail.startsWith("<") || detail.length > 180 ? "助教暂时无法回答" : detail;
        throw new Error(brief);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (chatRunId.current === run) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
      if (chatRunId.current !== run) reader.cancel();
      append(decoder.decode());
      if (frame) cancelAnimationFrame(frame);
      flush();
    } catch (error) {
      fail(error instanceof Error ? error.message : "发送失败");
    } finally {
      if (frame) cancelAnimationFrame(frame);
      if (chatRunId.current !== run) return;
      flush();
      setChatLoading(false);
    }
  }

  const visibleRecordId = mode === "quiz" ? quizRecordId : outlineRecordId;
  const visibleRecord = records.find((record) => record.id === visibleRecordId);
  const showFavorite = Boolean(
    visibleRecord && (mode === "quiz" ? quizResult.length > 0 : outlineResult && generating !== "outline"),
  );

  return (
    <div className="relative min-h-screen bg-slate-200 md:h-screen md:overflow-hidden dark:bg-slate-950">
      {sidebarOpen || isFullscreen ? null : (
        <button
          type="button"
          aria-label="展开侧栏"
          onClick={() => setSidebarOpen(true)}
          className="absolute top-4 left-4 z-50 flex size-10 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 shadow-md transition-colors hover:text-indigo-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:text-indigo-300"
        >
          <PanelLeftOpen className="size-5" />
        </button>
      )}
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-10 sm:px-12 md:h-full md:min-h-0 md:overflow-hidden">
        <header className="mb-8 flex shrink-0 items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              AI 课程复习百宝箱
            </h1>
            <p className="mt-2 text-base text-slate-500 dark:text-slate-400">
              上传课件，生成清晰的复习大纲或测验
            </p>
          </div>
          <ThemeToggle />
        </header>

        <div className="flex min-h-0 w-full flex-1 flex-col items-stretch gap-4 md:h-[calc(100vh-11.25rem)] md:flex-row md:gap-8">
          <aside
            aria-hidden={!sidebarOpen || isFullscreen}
            className={`flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden transition-all duration-300 ease-in-out ${
              isFullscreen ? "hidden" : sidebarOpen ? "h-full w-full md:w-80" : "h-0 w-0"
            }`}
          >
          <Card className="flex h-full min-h-0 w-full flex-col gap-0 overflow-hidden rounded-2xl border border-slate-300 bg-white py-0 shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-0 md:w-80 dark:border-slate-800 dark:bg-slate-900 dark:shadow-lg">
            <div className="flex h-14 shrink-0 items-center gap-2 px-2">
              <button
                type="button"
                aria-label="收起侧栏"
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen(false)}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors duration-300 hover:bg-slate-100 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-indigo-300"
              >
                <PanelLeftClose className="size-5" />
              </button>
              <span
                className={`whitespace-nowrap text-sm font-medium text-slate-900 transition-opacity duration-300 dark:text-slate-100 ${
                  sidebarOpen ? "opacity-100" : "opacity-0"
                }`}
              >
                复习设置
              </span>
            </div>
            <CardContent
              aria-hidden={!sidebarOpen}
              className={`flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-4 pb-3 transition-opacity duration-300 ${
                sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <div className="flex shrink-0 flex-col gap-4">
              <FileUpload
                file={file}
                accept={ACCEPT}
                disabled={generating !== null}
                inputRef={inputRef}
                onFile={chooseFile}
                onClear={clearFile}
              />
              {notice ? <p className="text-xs text-red-600 dark:text-red-400">{notice}</p> : null}

              <fieldset>
                <legend className="text-sm font-medium text-slate-900 dark:text-slate-100">复习模式</legend>
                <div className="mt-2 grid gap-2">
                  {(
                    [
                      ["outline", "生成大纲"],
                      ["quiz", "生成测验"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-slate-900 transition-all duration-300 dark:text-slate-100 ${
                        mode === value
                          ? "border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/40"
                          : "border-slate-300 bg-slate-100 hover:border-indigo-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-600"
                      }`}
                    >
                      <input
                        type="radio"
                        name="review-mode"
                        value={value}
                        checked={mode === value}
                        onChange={() => setMode(value)}
                        className="accent-indigo-500"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">复习风格</p>
                <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="复习风格">
                  {(
                    [
                      ["normal", "📖", "基础巩固"],
                      ["expert", "🎓", "深度进阶"],
                      ["exam", "🎯", "考前押题"],
                    ] as const
                  ).map(([value, emoji, label]) => {
                    const selected = reviewStyle === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setReviewStyle(value)}
                        className={`flex flex-col items-center gap-0.5 rounded-lg border px-1 py-2 text-xs font-medium transition-colors ${
                          selected
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-slate-100 text-slate-600 hover:border-indigo-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-indigo-600"
                        }`}
                      >
                        <span aria-hidden="true">{emoji}</span>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                type="button"
                size="lg"
                onClick={handleStart}
                disabled={!file || generating !== null}
                className={`h-auto min-h-11 w-full shrink whitespace-normal! rounded-xl px-3 py-2.5 text-center shadow-sm transition-all duration-300 ${
                  file
                    ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:scale-[1.02] hover:from-indigo-600 hover:to-purple-600 disabled:opacity-80!"
                    : "bg-slate-200! text-slate-500! shadow-none hover:scale-100 disabled:bg-slate-200! disabled:text-slate-500! disabled:opacity-100! dark:bg-slate-800! dark:text-slate-400! dark:disabled:bg-slate-800! dark:disabled:text-slate-400!"
                }`}
              >
                {generating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {generating === "quiz" && quizResult.length > 0
                  ? "正在生成新题目，请稍候..."
                  : generating === "quiz"
                    ? "正在生成测验…"
                    : generating === "outline"
                      ? "正在生成大纲…"
                      : "开始复习"}
              </Button>
              {(mode === "quiz" ? quizResult.length > 0 : Boolean(outlineResult)) && generating === null ? (
                <button
                  type="button"
                  onClick={clearCurrentResult}
                  className="text-xs text-slate-500 transition-colors duration-300 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
                >
                  清空当前结果
                </button>
              ) : null}
              </div>
              <HistoryList
                records={records}
                activeId={mode === "quiz" ? quizRecordId : outlineRecordId}
                onSelect={openHistory}
                onToggleFavorite={toggleFavorite}
                onDelete={deleteHistory}
                onClearAll={clearAllHistory}
              />
            </CardContent>
          </Card>
          </aside>

          <div
            className={
              isFullscreen
                ? "fixed inset-0 z-[100] flex min-h-0 flex-col overflow-y-auto bg-slate-200 p-4 md:p-8 dark:bg-slate-950"
                : "h-[calc(100vh-11.25rem)] min-h-0 w-full min-w-0 flex-1 md:h-full"
            }
          >
          <Group orientation="vertical" className="h-full min-h-0 flex-1">
          <Panel id="review" defaultSize="60%" minSize="20%" className="min-h-0" style={{ overflow: "hidden" }}>
          <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.12)] ring-0 dark:border-slate-800 dark:bg-slate-900 dark:shadow-lg">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-300 px-4 py-2.5 dark:border-slate-800">
              <p className="min-w-0 truncate text-sm text-slate-600 dark:text-slate-300">
                {visibleRecord && showFavorite ? visibleRecord.fileName : "复习结果"}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                {visibleRecord && showFavorite ? (
                  <button
                    type="button"
                    aria-pressed={visibleRecord.isFavorite}
                    onClick={() => toggleFavorite(visibleRecord.id)}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors ${
                      visibleRecord.isFavorite
                        ? "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                        : "bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-amber-950/40 dark:hover:text-amber-300"
                    }`}
                  >
                    <Star className={`size-4 ${visibleRecord.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                    {visibleRecord.isFavorite ? "取消收藏" : "收藏"}
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-pressed={isFullscreen}
                  aria-label={isFullscreen ? "退出全屏" : "全屏"}
                  onClick={() => setIsFullscreen((current) => !current)}
                  className="flex size-9 items-center justify-center rounded-xl bg-slate-100 text-slate-500 transition-colors hover:bg-slate-100 hover:text-indigo-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-indigo-300"
                >
                  {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              </div>
            </div>
            <CardContent
              ref={reviewRef}
              onScroll={(event) => {
                const pane = event.currentTarget;
                stickToBottom.current =
                  pane.scrollHeight - pane.scrollTop - pane.clientHeight < 48;
              }}
              className="review-scroll flex h-full min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
            >
              {mode === "quiz" ? (
                quizResult.length > 0 ? (
                  <div
                    className={`transition-opacity duration-300 ${
                      generating === "quiz" ? "opacity-60" : "opacity-100"
                    }`}
                  >
                    <QuizBoard
                      questions={quizResult}
                      selectedAnswers={selectedAnswers}
                      revealedAnswers={revealedAnswers}
                      onSelect={(index, letter) => {
                        setSelectedAnswers((current) =>
                          current[index] ? current : { ...current, [index]: letter },
                        );
                        setRevealedAnswers((current) => ({ ...current, [index]: true }));
                      }}
                      onReveal={(index) => {
                        setRevealedAnswers((current) => ({ ...current, [index]: true }));
                      }}
                    />
                  </div>
                ) : generating === "quiz" ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
                    <Loader2 className="size-8 animate-spin text-indigo-500" />
                    <p className="text-sm">正在生成测验…</p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <FileText className="size-16 text-slate-300 dark:text-slate-600" strokeWidth={1.25} />
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {file ? "点击「开始复习」生成测验" : "请上传文档开始"}
                    </p>
                  </div>
                )
              ) : outlineResult ? (
                <div className="prose prose-slate max-w-none dark:prose-invert lg:prose-lg">
                  <MarkdownContent
                    text={normalizeLatexDelimiters(outlineResult)}
                    rehypePlugins={
                      generating === "outline" ? [katexPlugin, rehypeStreamingCursor] : [katexPlugin]
                    }
                  />
                </div>
              ) : generating === "outline" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
                  <Loader2 className="size-8 animate-spin text-indigo-500" />
                  <p className="text-sm">正在读取课件并生成内容…</p>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                  <FileText className="size-16 text-slate-300 dark:text-slate-600" strokeWidth={1.25} />
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {file ? "点击「开始复习」生成大纲" : "请上传文档开始"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          </Panel>
          <Separator aria-label="调整刷题和助教高度" className="group flex h-3 cursor-row-resize items-center outline-none">
            <span className="h-px w-full rounded-full bg-slate-300 transition-all duration-200 group-hover:h-1.5 group-hover:bg-indigo-400 group-data-[separator=active]:h-1.5 group-data-[separator=active]:bg-indigo-500 dark:bg-slate-700" />
          </Separator>
          <Panel id="tutor" defaultSize="40%" minSize="18%" className="min-h-0" style={{ overflow: "hidden" }}>
          <TutorChat
            messages={messages}
            draft={chatDraft}
            loading={chatLoading}
            onDraftChange={setChatDraft}
            onSend={sendChat}
          />
          </Panel>
          </Group>
          </div>
        </div>
      </div>
    </div>
  );
}
