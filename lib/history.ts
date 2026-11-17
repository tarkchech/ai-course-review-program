export type HistoryMode = "outline" | "quiz";

export interface HistoryRecord {
  id: string;
  fileName: string;
  mode: HistoryMode;
  content: string;
  timestamp: number;
  isFavorite: boolean;
}

const STORAGE_KEY = "ai-course-review-history";
export const HISTORY_LIMIT = 40;

export function createHistoryRecord(
  fileName: string,
  mode: HistoryMode,
  content: string,
): HistoryRecord {
  const timestamp = Date.now();
  return {
    id: String(timestamp),
    fileName,
    mode,
    content,
    timestamp,
    isFavorite: false,
  };
}

export function readHistory(): HistoryRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isHistoryRecord)
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function writeHistory(records: HistoryRecord[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
  } catch (error) {
    console.error("Failed to save history:", error);
  }
}

function isHistoryRecord(value: unknown): value is HistoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<HistoryRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.fileName === "string" &&
    (record.mode === "outline" || record.mode === "quiz") &&
    typeof record.content === "string" &&
    typeof record.timestamp === "number" &&
    typeof record.isFavorite === "boolean"
  );
}
