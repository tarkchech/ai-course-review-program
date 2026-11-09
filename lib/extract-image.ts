import fs from "node:fs";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

const LANG_DIR = path.join(process.cwd(), ".tessdata");

const TRAINEDDATA = {
  chi_sim: path.join(
    process.cwd(),
    "node_modules/@tesseract.js-data/chi_sim/4.0.0/chi_sim.traineddata.gz",
  ),
  eng: path.join(
    process.cwd(),
    "node_modules/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz",
  ),
} as const;

function ensureLangFiles() {
  fs.mkdirSync(LANG_DIR, { recursive: true });

  for (const [lang, source] of Object.entries(TRAINEDDATA)) {
    const destination = path.join(LANG_DIR, `${lang}.traineddata.gz`);
    if (!fs.existsSync(destination)) {
      fs.copyFileSync(source, destination);
    }
  }
}

let workerPromise: Promise<Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    ensureLangFiles();
    workerPromise = createWorker("chi_sim+eng", 1, {
      langPath: LANG_DIR,
      cachePath: LANG_DIR,
      gzip: true,
    }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }

  return workerPromise;
}

export async function extractImageText(data: Buffer) {
  const worker = await getWorker();
  const result = await worker.recognize(data);
  return result.data.text.replace(/\s+\n/g, "\n").trim();
}
