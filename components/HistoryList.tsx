"use client";

import { useState } from "react";
import { Star } from "lucide-react";

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
}: {
  records: HistoryRecord[];
  activeId: string | null;
  onSelect: (record: HistoryRecord) => void;
  onToggleFavorite: (id: string) => void;
}) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const visible = filter === "favorite" ? records.filter((record) => record.isFavorite) : records;

  return (
    <section className="border-t border-slate-100 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-800">历史记录</p>
        <span className="text-xs text-slate-400">{records.length}</span>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
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
              filter === value ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="review-scroll mt-2 flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-0.5">
        {visible.length === 0 ? (
          <li className="px-1 py-5 text-center text-xs text-slate-400">
            {filter === "favorite" ? "还没有收藏" : "生成后会自动出现在这里"}
          </li>
        ) : (
          visible.map((record) => {
            const active = record.id === activeId;
            return (
              <li key={record.id}>
                <div
                  className={`flex items-start gap-1 rounded-xl px-2 py-1.5 transition-colors ${
                    active ? "bg-indigo-50" : "hover:bg-slate-50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelect(record)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-sm font-medium text-slate-700">{record.fileName}</span>
                    <span className="mt-1 flex items-center gap-1.5">
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
                          record.mode === "quiz" ? "bg-violet-50 text-violet-600" : "bg-sky-50 text-sky-600"
                        }`}
                      >
                        {MODE_LABEL[record.mode]}
                      </span>
                      <span className="text-[11px] text-slate-400">{formatHistoryTime(record.timestamp)}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={record.isFavorite ? "取消收藏" : "收藏"}
                    aria-pressed={record.isFavorite}
                    onClick={() => onToggleFavorite(record.id)}
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-white hover:text-amber-500"
                  >
                    <Star className={`size-3.5 ${record.isFavorite ? "fill-amber-400 text-amber-400" : ""}`} />
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
