"use server";

import "pdf-parse/worker";
import { PDFParse, type TextResult } from "pdf-parse";

/**
 * 从浏览器上传的 PDF 文件中提取纯文本。
 * 这是 Server Action：页面可以直接调用，解析仍在服务端完成。
 */
export async function extractTextFromPDF(file: File): Promise<string> {
  const data: ArrayBuffer = await file.arrayBuffer();
  const parser = new PDFParse({ data });

  try {
    const result: TextResult = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}
