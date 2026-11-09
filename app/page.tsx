"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { FileUp, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { extractTextFromPDF } from "@/app/utils/pdf";

type ReviewMode = "outline" | "quiz";

const ACCEPT = ".pdf,application/pdf";

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const runId = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const [mode, setMode] = useState<ReviewMode>("outline");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    return () => {
      runId.current += 1;
    };
  }, []);

  function chooseFile(next: File | null) {
    if (!next) return;
    if (!isPdf(next)) {
      setNotice("目前只支持 PDF");
      return;
    }
    setNotice("");
    setFile(next);
    setResult("");
  }

  async function handleStart() {
    if (!file || loading) return;

    const id = ++runId.current;
    setLoading(true);
    setResult("");
    setNotice("");

    try {
      const text = await extractTextFromPDF(file);
      if (runId.current !== id) return;
      if (!text.trim()) {
        throw new Error("没有从文件中提取到文本");
      }

      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode }),
      });
      if (runId.current !== id) return;
      if (!response.ok || !response.body) {
        throw new Error((await response.text()) || "生成失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done || runId.current !== id) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) {
          setResult((prev) => prev + chunk);
        }
      }

      const tail = decoder.decode();
      if (tail && runId.current === id) {
        setResult((prev) => prev + tail);
      }
    } catch (error) {
      if (runId.current !== id) return;
      setResult("");
      setNotice(error instanceof Error ? error.message : "生成失败");
    } finally {
      if (runId.current === id) setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight text-stone-800">
            AI 课程复习百宝箱
          </h1>
          <p className="mt-2 text-base text-stone-500">
            上传课件，生成清晰的复习大纲或测验
          </p>
        </header>

        <Card className="flex-1 border border-stone-200 bg-white shadow-sm ring-0">
          <CardContent className="grid flex-1 grid-cols-1 gap-6 py-2 md:grid-cols-3">
            <section className="flex flex-col gap-4 md:col-span-1">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  chooseFile(event.dataTransfer.files?.[0] ?? null);
                }}
                className={`rounded-xl border border-dashed bg-stone-50/50 transition-all duration-300 hover:border-indigo-300 ${
                  dragging ? "border-indigo-300" : "border-stone-300"
                }`}
              >
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full flex-col items-center gap-3 px-4 py-10 text-center"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm">
                    <FileUp className="size-5" />
                  </span>
                  <span className="text-sm font-medium text-stone-800">
                    拖拽文件到这里，或点击选择
                  </span>
                  <span className="text-xs text-stone-500">目前仅支持 PDF</span>
                </button>
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
                {file ? (
                  <p className="mx-4 mb-4 truncate rounded-lg bg-white px-3 py-2 text-xs text-stone-500">
                    已选择：{file.name}
                  </p>
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
                disabled={!file || loading}
                className="h-11 rounded-xl bg-indigo-500 text-white hover:bg-indigo-600"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                开始复习
              </Button>
            </section>

            <section className="min-h-[28rem] rounded-xl bg-stone-50/40 p-5 md:col-span-2">
              {result ? (
                <div className="prose prose-stone max-w-none text-stone-700 prose-headings:text-stone-800 prose-strong:text-stone-800">
                  <ReactMarkdown>{result}</ReactMarkdown>
                </div>
              ) : loading ? (
                <div className="flex h-full min-h-[24rem] flex-col items-center justify-center gap-3 text-stone-500">
                  <Loader2 className="size-8 animate-spin text-indigo-500" />
                  <p className="text-sm">正在读取课件并生成内容…</p>
                </div>
              ) : (
                <div className="flex h-full min-h-[24rem] items-center justify-center text-sm text-stone-500">
                  请上传文档开始
                </div>
              )}
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
