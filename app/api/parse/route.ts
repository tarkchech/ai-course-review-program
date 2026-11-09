import { NextResponse } from "next/server";

import { extractImageText } from "@/lib/extract-image";
import { extractPdfText } from "@/lib/extract-pdf";
import { extractPptxText } from "@/lib/extract-pptx";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

type FileKind = "pdf" | "pptx" | "jpg";

function detectKind(file: File): FileKind | null {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    name.endsWith(".pptx") ||
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (name.endsWith(".jpg") || name.endsWith(".jpeg") || file.type === "image/jpeg") {
    return "jpg";
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "请上传 PDF、PPTX 或 JPG 文件" }, { status: 400 });
    }

    if (file.name.toLowerCase().endsWith(".ppt")) {
      return NextResponse.json(
        { error: "暂不支持旧版 .ppt，请在 PowerPoint 中另存为 .pptx 后再上传" },
        { status: 400 },
      );
    }

    const kind = detectKind(file);
    if (!kind) {
      return NextResponse.json(
        { error: "只支持 PDF、PPTX 和 JPG 三种格式" },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: "文件过大，请上传 20MB 以内的文件" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const text =
      kind === "pdf"
        ? await extractPdfText(bytes)
        : kind === "pptx"
          ? await extractPptxText(bytes)
          : await extractImageText(Buffer.from(bytes));

    if (!text) {
      const emptyMessage =
        kind === "jpg"
          ? "没有从图片中识别到文字，请换一张更清晰的 JPG"
          : kind === "pptx"
            ? "没有从 PPTX 中提取到文字，可能是纯图片幻灯片"
            : "未能从 PDF 中提取到文本，可能是扫描件或图片型 PDF";

      return NextResponse.json({ error: emptyMessage }, { status: 422 });
    }

    return NextResponse.json({
      text,
      fileName: file.name,
      kind,
    });
  } catch (error) {
    console.error("Document parse failed:", error);
    return NextResponse.json({ error: "解析文件失败，请换一份文件再试" }, { status: 500 });
  }
}
