"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Group, Panel, Separator } from "react-resizable-panels";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { FileText, FileUp, Loader2, PanelLeftClose, PanelLeftOpen, Send, Sparkles, Star, X } from "lucide-react";

import { HistoryList } from "@/components/HistoryList";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useHistory } from "@/hooks/use-history";
import { createHistoryRecord } from "@/lib/history";
import { extractTextFromPDF } from "@/app/utils/pdf";
import { extractTextFromPPTX } from "@/app/utils/pptx";

type ReviewMode = "outline" | "quiz";
type UploadKind = "pdf" | "pptx";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface QuizQuestion {
  type: "choice" | "fill_blank" | "calculation";
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

const mathPlugins = [remarkMath, remarkGfm] as const;
const katexPlugins = [rehypeKatex] as const;

/** 把 \( \) / \[ \] 转成 $，并转义公式外的变量下划线，避免 I_D 被 Markdown 当成斜体。 */
function normalizeLatexDelimiters(markdown: string) {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, index) => (index % 2 === 1 ? part : escapePlainTextUnderscores(part)))
    .join("");
}

function escapePlainTextUnderscores(text: string) {
  const withDollars = text
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, expression: string) => `$$${expression}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, expression: string) => `$${expression}$`);

  return withDollars
    .split(/(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$)/g)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/([A-Za-z0-9])_([A-Za-z0-9])/g, "$1\\_$2"),
    )
    .join("");
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

    return { type, question, options, answer, explanation };
  });
}

function optionButtonClass(letter: string, selected: string | undefined, answer: string) {
  const base =
    "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-all duration-300 disabled:cursor-default disabled:opacity-100";
  if (!selected) {
    return `${base} border-slate-200 bg-white text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/70 active:scale-[0.99]`;
  }
  if (letter === answer) {
    return `${base} border-emerald-400 bg-emerald-50 text-emerald-800`;
  }
  if (letter === selected) {
    return `${base} border-red-400 bg-red-50 text-red-700`;
  }
  return `${base} border-slate-200 bg-white text-slate-400`;
}

function letterBadgeClass(letter: string, selected: string | undefined, answer: string) {
  const base =
    "flex size-7 shrink-0 items-center justify-center rounded-lg text-xs font-semibold transition-colors duration-300";
  if (!selected) return `${base} bg-slate-100 text-slate-600`;
  if (letter === answer) return `${base} bg-emerald-500 text-white`;
  if (letter === selected) return `${base} bg-red-500 text-white`;
  return `${base} bg-slate-100 text-slate-400`;
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
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [messages, loading]);

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg ring-0">
      <div className="shrink-0 border-b border-slate-100 px-4 py-3">
        <p className="text-sm font-medium text-slate-800">AI 助教</p>
        <p className="text-xs text-slate-400">针对当前课件继续追问</p>
      </div>
      <div ref={listRef} className="review-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="m-auto text-center text-sm text-slate-400">可以问助教：这个概念怎么考？</p>
        ) : (
          messages.map((message) => {
            const mine = message.role === "user";
            const streaming = !mine && loading && message.id === messages[messages.length - 1]?.id;
            return (
              <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-6 ${
                    mine
                      ? "rounded-br-md bg-indigo-600 text-white"
                      : "rounded-bl-md border border-slate-100 bg-slate-50 text-slate-700"
                  }`}
                >
                  {mine ? (
                    <p className="whitespace-pre-wrap">{message.content}</p>
                  ) : message.content ? (
                    <QuizMarkdown text={message.content} />
                  ) : streaming ? (
                    <span className="streaming-cursor" aria-hidden="true" />
                  ) : null}
                  {streaming && message.content ? (
                    <span className="streaming-cursor" aria-hidden="true" />
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <form
        className="flex shrink-0 items-center gap-2 border-t border-slate-100 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSend();
        }}
      >
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder="输入你的问题"
          disabled={loading}
          className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none transition-all duration-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
        />
        <Button
          type="submit"
          disabled={loading || !draft.trim()}
          className="h-11 rounded-xl bg-indigo-600 px-4 text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          发送
        </Button>
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
          ? "prose prose-slate inline max-w-none text-sm prose-p:my-0"
          : "prose prose-slate max-w-none text-sm prose-p:my-1 prose-headings:my-2"
      }
    >
      <ReactMarkdown
        remarkPlugins={[...mathPlugins]}
        rehypePlugins={[...katexPlugins]}
        components={inline ? { p: ({ children }) => <>{children}</> } : undefined}
      >
        {normalizeLatexDelimiters(text)}
      </ReactMarkdown>
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
          <p className="text-xs font-semibold text-emerald-700">标准答案</p>
          <QuizMarkdown text={question.answer} />
          <div className="mt-3 border-t border-emerald-200/80 pt-3">
            <p className="text-xs font-semibold text-emerald-700">解析</p>
            <QuizMarkdown text={question.explanation || "这道题没有附加解析。"} />
          </div>
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
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const checked = Object.keys(revealedAnswers).length;
  const correct = questions.filter(
    (question, index) => question.type === "choice" && selectedAnswers[index] === question.answer,
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-700">互动刷题</p>
        <p className="text-xs text-slate-400">
          已核对 {checked}/{questions.length}
          {checked > 0 ? ` · 选择题答对 ${correct}` : ""}
        </p>
      </div>
      {questions.map((question, index) => {
        const selected = selectedAnswers[index];
        const revealed = Boolean(revealedAnswers[index]);
        const fieldClass = `w-full rounded-xl border px-4 py-3 text-sm text-slate-800 outline-none transition-all duration-300 ${
          revealed
            ? "border-slate-200 bg-slate-50 text-slate-600"
            : "border-slate-200 bg-white focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
        }`;
        return (
          <article
            key={`${index}-${question.question}`}
            className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4 shadow-sm transition-shadow duration-300 hover:shadow-md sm:p-5"
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-xs font-semibold text-white">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium text-indigo-500">{QUIZ_TYPE_LABEL[question.type]}</p>
                <h3 className="mt-1 text-sm font-medium leading-6 text-slate-800">
                  <QuizMarkdown text={question.question} inline />
                </h3>
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
                ) : (
                  <textarea
                    value={drafts[index] ?? ""}
                    readOnly={revealed}
                    rows={4}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [index]: event.target.value }))
                    }
                    placeholder="可以在这里打草稿，不必填写"
                    className={`${fieldClass} resize-y`}
                  />
                )}
                {revealed ? null : (
                  <button
                    type="button"
                    onClick={() => onReveal(index)}
                    className="mt-3 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-medium text-indigo-600 transition-all duration-300 hover:bg-indigo-50"
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
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/80 px-4 py-3 text-sm leading-6 text-slate-700">
                    <p className="text-xs font-medium text-indigo-600">
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
  const { records, addRecord, toggleFavorite } = useHistory();
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [revealedAnswers, setRevealedAnswers] = useState<Record<number, boolean>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [extractedText, setExtractedText] = useState("");
  const extractedTextRef = useRef("");
  const [mode, setMode] = useState<ReviewMode>("outline");
  const [dragging, setDragging] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
    setMessages([]);
  }

  function clearFile() {
    setFile(null);
    setDragging(false);
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

  async function handleStart() {
    if (!file || generating) return;
    if (file.size > 20 * 1024 * 1024) {
      setNotice("文件超过 20MB，请换一份较小的文件");
      return;
    }

    const id = ++runId.current;
    const activeMode = mode;
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
        body: JSON.stringify({ text, mode: activeMode, attemptCount }),
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
      if (!chunk) return;
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
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
      append(decoder.decode());
      if (frame) cancelAnimationFrame(frame);
      flush();
    } catch (error) {
      fail(error instanceof Error ? error.message : "发送失败");
    } finally {
      if (frame) cancelAnimationFrame(frame);
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
    <div className="min-h-screen bg-slate-50 md:h-screen md:overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-10 sm:px-12 md:h-full md:min-h-0 md:overflow-hidden">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-800">
            AI 课程复习百宝箱
          </h1>
          <p className="mt-2 text-base text-slate-500">
            上传课件，生成清晰的复习大纲或测验
          </p>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:gap-8">
          <aside
            className={`shrink-0 overflow-hidden transition-all duration-300 ease-in-out ${
              sidebarOpen
                ? "h-[calc(100vh-200px)] w-full md:w-80"
                : "h-14 w-full md:h-[calc(100vh-200px)] md:w-14"
            }`}
          >
          <Card className="flex h-full w-full flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg ring-0 md:w-80">
            <div className="flex h-14 shrink-0 items-center gap-2 px-2">
              <button
                type="button"
                aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"}
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen((open) => !open)}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors duration-300 hover:bg-slate-100 hover:text-indigo-600"
              >
                {sidebarOpen ? <PanelLeftClose className="size-5" /> : <PanelLeftOpen className="size-5" />}
              </button>
              <span
                className={`whitespace-nowrap text-sm font-medium text-slate-700 transition-opacity duration-300 ${
                  sidebarOpen ? "opacity-100" : "opacity-0"
                }`}
              >
                复习设置
              </span>
            </div>
            <CardContent
              aria-hidden={!sidebarOpen}
              className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto transition-opacity duration-300 ${
                sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
              }`}
            >
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(event) => {
                  chooseFile(event.target.files?.[0] ?? null);
                  event.target.value = "";
                }}
              />
              <div
                aria-hidden={Boolean(file)}
                onDragOver={(event) => {
                  event.preventDefault();
                  if (file) return;
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  if (file) return;
                  chooseFile(event.dataTransfer.files?.[0] ?? null);
                }}
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  file ? "pointer-events-none max-h-0 opacity-0" : "max-h-56 opacity-100"
                }`}
              >
                <button
                  type="button"
                  disabled={Boolean(file)}
                  onClick={() => inputRef.current?.click()}
                  className={`flex w-full flex-col items-center gap-3 rounded-xl border border-dashed bg-white px-4 py-10 text-center transition-all duration-300 hover:border-indigo-400 hover:bg-slate-50 ${
                    dragging ? "border-indigo-400 bg-slate-50" : "border-slate-300"
                  }`}
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm">
                    <FileUp className="size-5" />
                  </span>
                  <span className="text-sm font-medium text-stone-800">
                    拖拽文件到这里，或点击选择
                  </span>
                  <span className="text-xs text-stone-500">支持 PDF、PPTX</span>
                </button>
              </div>
              <div
                aria-hidden={!file}
                className={`overflow-hidden transition-all duration-300 ease-in-out ${
                  file ? "max-h-24 opacity-100" : "pointer-events-none max-h-0 opacity-0"
                }`}
              >
                {file ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-500 shadow-sm">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">{file.name}</p>
                      <button
                        type="button"
                        onClick={() => {
                          clearFile();
                          inputRef.current?.click();
                        }}
                        disabled={generating !== null}
                        className="text-xs text-indigo-600 transition-colors duration-300 hover:text-indigo-700 disabled:text-slate-400"
                      >
                        重新上传
                      </button>
                    </div>
                    <button
                      type="button"
                      aria-label="移除文件"
                      onClick={clearFile}
                      disabled={generating !== null}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-all duration-300 hover:bg-white hover:text-slate-700 disabled:opacity-40"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : null}
              </div>
              {notice ? <p className="text-xs text-red-600">{notice}</p> : null}

              <fieldset>
                <legend className="text-sm font-medium text-stone-800">复习模式</legend>
                <div className="mt-2 grid gap-2">
                  {(
                    [
                      ["outline", "生成大纲"],
                      ["quiz", "生成测验"],
                    ] as const
                  ).map(([value, label]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-stone-700 transition-all duration-300 ${
                        mode === value
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-stone-200 bg-white hover:border-indigo-300"
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

              <Button
                type="button"
                size="lg"
                onClick={handleStart}
                disabled={!file || generating !== null}
                className={`h-auto min-h-11 w-full shrink whitespace-normal! rounded-xl px-3 py-2.5 text-center shadow-sm transition-all duration-300 ${
                  file
                    ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:scale-[1.02] hover:from-indigo-600 hover:to-purple-600 disabled:opacity-80!"
                    : "bg-slate-200! text-slate-400! shadow-none hover:scale-100 disabled:bg-slate-200! disabled:text-slate-400! disabled:opacity-100!"
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
                  className="text-xs text-slate-400 transition-colors duration-300 hover:text-slate-600"
                >
                  清空当前结果
                </button>
              ) : null}
              <HistoryList
                records={records}
                activeId={mode === "quiz" ? quizRecordId : outlineRecordId}
                onSelect={openHistory}
                onToggleFavorite={toggleFavorite}
              />
            </CardContent>
          </Card>
          </aside>

          <div className="h-[calc(100vh-200px)] min-h-0 w-full min-w-0 flex-1">
          <Group orientation="vertical" className="h-full min-h-0">
          <Panel id="review" defaultSize="60%" minSize="20%" className="min-h-0" style={{ overflow: "hidden" }}>
          <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-lg ring-0">
            {visibleRecord && showFavorite ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
                <p className="min-w-0 truncate text-sm text-slate-600">{visibleRecord.fileName}</p>
                <button
                  type="button"
                  aria-pressed={visibleRecord.isFavorite}
                  onClick={() => toggleFavorite(visibleRecord.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm transition-colors ${
                    visibleRecord.isFavorite
                      ? "bg-amber-50 text-amber-600"
                      : "bg-slate-50 text-slate-500 hover:bg-amber-50 hover:text-amber-600"
                  }`}
                >
                  <Star className={`size-4 ${visibleRecord.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                  {visibleRecord.isFavorite ? "取消收藏" : "收藏"}
                </button>
              </div>
            ) : null}
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
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                    <Loader2 className="size-8 animate-spin text-indigo-500" />
                    <p className="text-sm">正在生成测验…</p>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-4">
                    <FileText className="size-16 text-slate-300" strokeWidth={1.25} />
                    <p className="text-sm text-slate-400">
                      {file ? "点击「开始复习」生成测验" : "请上传文档开始"}
                    </p>
                  </div>
                )
              ) : outlineResult ? (
                <div className="prose prose-slate lg:prose-lg max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[...mathPlugins]}
                    rehypePlugins={
                      generating === "outline"
                        ? [...katexPlugins, rehypeStreamingCursor]
                        : [...katexPlugins]
                    }
                  >
                    {normalizeLatexDelimiters(outlineResult)}
                  </ReactMarkdown>
                </div>
              ) : generating === "outline" ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="size-8 animate-spin text-indigo-500" />
                  <p className="text-sm">正在读取课件并生成内容…</p>
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-4">
                  <FileText className="size-16 text-slate-300" strokeWidth={1.25} />
                  <p className="text-sm text-slate-400">
                    {file ? "点击「开始复习」生成大纲" : "请上传文档开始"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          </Panel>
          <Separator aria-label="调整刷题和助教高度" className="group flex h-3 cursor-row-resize items-center outline-none">
            <span className="h-px w-full rounded-full bg-slate-300 transition-all duration-200 group-hover:h-1.5 group-hover:bg-indigo-400 group-data-[separator=active]:h-1.5 group-data-[separator=active]:bg-indigo-500" />
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
