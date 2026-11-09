import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";

export async function extractPdfText(data: Uint8Array) {
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    return result.text?.trim() ?? "";
  } finally {
    await parser.destroy();
  }
}
