"use server";

import { extractPptxText } from "@/lib/extract-pptx";

/**
 * 从浏览器上传的 PPTX 中提取幻灯片文字和备注。
 * 这是 Server Action：页面可以直接调用，解压仍在服务端完成。
 * 只支持 .pptx。旧版 .ppt 是二进制格式，不能用这套解析。
 */
export async function extractTextFromPPTX(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  return extractPptxText(data);
}
