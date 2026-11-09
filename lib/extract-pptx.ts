import JSZip from "jszip";

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function slideNumber(name: string) {
  return Number(name.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
}

function textFromSlideXml(xml: string) {
  const lines: string[] = [];

  for (const paragraph of xml.split(/<a:p(?:\s[^>]*)?>/).slice(1)) {
    const runs = [...paragraph.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(
      (match) => decodeXml(match[1]),
    );
    const line = runs.join("").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }

  return lines.join("\n");
}

async function notesForSlide(zip: JSZip, slideFileName: string) {
  const relsPath = `ppt/slides/_rels/slide${slideNumber(slideFileName)}.xml.rels`;
  const relsFile = zip.file(relsPath);
  if (!relsFile) return "";

  const rels = await relsFile.async("string");
  const target = rels.match(/Target="([^"]*notesSlides\/[^"]+)"/)?.[1];
  if (!target) return "";

  const notesPath = new URL(target, "file:///ppt/slides/").pathname.replace(/^\//, "");
  const notesFile = zip.file(notesPath);
  if (!notesFile) return "";

  return textFromSlideXml(await notesFile.async("string"));
}

export async function extractPptxText(data: Uint8Array) {
  const zip = await JSZip.loadAsync(data);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const parts: string[] = [];

  for (const name of slideNames) {
    const file = zip.file(name);
    if (!file) continue;

    const body = textFromSlideXml(await file.async("string"));
    const notes = await notesForSlide(zip, name);
    if (!body && !notes) continue;

    const chunks = [`## 第 ${slideNumber(name)} 页`];
    if (body) chunks.push(body);
    if (notes) chunks.push(`备注：\n${notes}`);
    parts.push(chunks.join("\n"));
  }

  return parts.join("\n\n").trim();
}
