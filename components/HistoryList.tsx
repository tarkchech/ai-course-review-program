"use client";

import { useState } from "react";
import { Star, Trash2 } from "lucide-react";

import type { HistoryRecord } from "@/lib/history";

type HistoryFilter = "all" | "favorite";

const MODE_LABEL = {
  outline: "大纲",
  quiz: "测验",
} as const;

function formatHistoryTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export function HistoryList({
  records,
  activeId,
  onSelect,
  onToggleFavorite,
  onDelete,
  onClearAll,
}: {
  records: HistoryRecord[];
  activeId: string | null;
  onSelect: (record: HistoryRecord) => void;
  onToggleFavorite: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const visible = filter === "favorite" ? records.filter((record) => record.isFavorite) : records;

  return (
    <section className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-slate-300 pt-3 dark:border-slate-800">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">历史记录</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (records.length === 0) return;
              if (!window.confirm("确定要清空全部历史记录吗？")) return;
              onClearAll();
            }}
            disabled={records.length === 0}
            className="text-xs text-slate-400 transition-colors hover:text-red-500 disabled:cursor-default disabled:hover:text-slate-400 dark:text-slate-500 dark:hover:text-red-500 dark:disabled:hover:text-slate-500"
          >
            清空全部
          </button>
          <span className="text-xs text-slate-500 dark:text-slate-400">{records.length}</span>
        </div>
      </div>
      <div className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-slate-200 p-1 dark:bg-slate-800">
        {(
          [
            ["all", "全部记录"],
            ["favorite", "仅看收藏"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
              filter === value
                ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-300"
                : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="history-scroll mt-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-0.5">
        {visible.length === 0 ? (
          <li className="px-1 py-5 text-center text-xs text-slate-500 dark:text-slate-400">
            {filter === "favorite" ? "还没有收藏" : "生成后会自动出现在这里"}
          </li>
        ) : (
          visible.map((record) => {
            const active = record.id === activeId;
            return (
              <li key={record.id}>
                <div
                  className={`flex items-start gap-1 rounded-xl px-2 py-1.5 transition-colors ${
                    active
                      ? "bg-indigo-50 ring-1 ring-indigo-200 dark:bg-slate-800 dark:ring-indigo-500"
                      : "hover:bg-gray-100 dark:hover:bg-slate-800"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(record)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-slate-900 dark:text-slate-100">{record.fileName}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          record.mode === "quiz"
                            ? "bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300"
                            : "bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-300"
                        }`}
                      >
                        {MODE_LABEL[record.mode]}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{formatHistoryTime(record.timestamp)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={record.isFavorite ? "取消收藏" : "收藏"}
                    aria-pressed={record.isFavorite}
                    onClick={() => onToggleFavorite(record.id)}
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-gray-100 hover:text-amber-500 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-amber-300"
                  >
                    <Star className={`size-3.5 ${record.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
                  </button>
                  <button
                    type="button"
                    aria-label="删除记录"
                    onClick={() => {
                      if (!window.confirm("确定要删除这条记录吗？")) return;
                      onDelete(record.id);
                    }}
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-gray-100 hover:text-red-500 dark:text-slate-500 dark:hover:bg-slate-700 dark:hover:text-red-500"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </li>
            );
          })
        )}
      </ul>
    </section>
  );
}
