"use client";

import { useMemo, useRef, useState } from "react";
import {
  FileUp,
  Loader2,
  Sparkles,
  Trash2,
  BookOpen,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export function ReviewToolbox() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string>("");
  const [extractedText, setExtractedText] = useState("");
  const [outline, setOutline] = useState("");
  const [status, setStatus] = useState<"idle" | "parsing" | "generating">("idle");
  const [error, setError] = useState("");

  const busy = status !== "idle";
  const charCount = useMemo(() => extractedText.length, [extractedText]);
  const parsingLabel = /\.jpe?g$/i.test(fileName) ? "正在识别图片…" : "正在解析…";

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowed = /\.(pdf|pptx|jpe?g)$/i.test(file.name);
    if (!allowed) {
      setError(
        file.name.toLowerCase().endsWith(".ppt")
          ? "暂不支持旧版 .ppt，请另存为 .pptx 后再上传"
          : "只支持 PDF、PPTX 和 JPG 三种格式",
      );
      return;
    }

    setError("");
    setOutline("");
    setStatus("parsing");
    setFileName(file.name);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/parse", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { text?: string; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "解析文件失败");
      }

      setExtractedText(data.text ?? "");
    } catch (err) {
      setFileName("");
      setExtractedText("");
      setError(err instanceof Error ? err.message : "解析文件失败");
    } finally {
      setStatus("idle");
    }
  }

  async function handleGenerate() {
    if (!extractedText.trim()) {
      setError("请先上传课程材料，或粘贴讲义文本");
      return;
    }

    setError("");
    setOutline("");
    setStatus("generating");

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: extractedText }),
      });

      if (!response.ok || !response.body) {
        const message = await response.text();
        throw new Error(message || "生成失败");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        setOutline((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setStatus("idle");
    }
  }

  function handleReset() {
    setFileName("");
    setExtractedText("");
    setOutline("");
    setError("");
    setStatus("idle");
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="size-4" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight">
                AI 课程复习百宝箱
              </h1>
              <p className="text-xs text-muted-foreground">
                上传 PDF、PPTX 或 JPG，流式生成核心考点大纲
              </p>
            </div>
          </div>
          <Badge variant="secondary">DeepSeek</Badge>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-2">
        <Card className="min-h-[70vh]">
          <CardHeader>
            <CardTitle>左侧：上传课程材料</CardTitle>
            <CardDescription>
              支持 PDF、PPTX 和 JPG。上传后自动提取文字，也可以直接粘贴讲义。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.pptx,.jpg,.jpeg,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/jpeg"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
              >
                {status === "parsing" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileUp className="size-4" />
                )}
                {status === "parsing" ? parsingLabel : "上传文件"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                disabled={busy}
              >
                <Trash2 className="size-4" />
                清空
              </Button>
              {fileName ? (
                <span className="truncate text-xs text-muted-foreground">
                  已选：{fileName} · {charCount} 字
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {charCount > 0 ? `当前文本 ${charCount} 字` : "尚未选择文件"}
                </span>
              )}
            </div>

            <Textarea
              value={extractedText}
              onChange={(event) => setExtractedText(event.target.value)}
              placeholder="提取出的文字会显示在这里，你也可以手动编辑后再生成大纲。"
              className="min-h-[42vh] flex-1 resize-none font-mono text-xs leading-5"
            />

            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                点击右侧按钮，会把当前文本发给 DeepSeek 并流式输出考点大纲。
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="min-h-[70vh]">
          <CardHeader>
            <CardTitle>右侧：核心考点大纲</CardTitle>
            <CardDescription>
              大模型边生成边显示，适合复习前快速过一遍重点。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-3">
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={busy || !extractedText.trim()}
            >
              {status === "generating" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {status === "generating" ? "正在生成…" : "生成考点大纲"}
            </Button>

            <Separator />

            <ScrollArea className="h-[52vh] rounded-lg border bg-background p-4">
              {outline ? (
                <pre className="whitespace-pre-wrap font-sans text-sm leading-7">
                  {outline}
                  {status === "generating" ? "▍" : ""}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {status === "generating"
                    ? "正在连接模型…"
                    : "生成结果会流式显示在这里。"}
                </p>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
