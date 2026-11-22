"use client";

import { useState, type RefObject } from "react";
import { FileText, FileUp, X } from "lucide-react";

export function FileUpload({
  file,
  accept,
  disabled,
  inputRef,
  onFile,
  onClear,
}: {
  file: File | null;
  accept: string;
  disabled?: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File | null) => void;
  onClear: () => void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(event) => {
          onFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {file ? (
        <div className="flex h-11 items-center gap-2 rounded-xl border border-slate-300 bg-slate-100 px-2.5 dark:border-slate-700 dark:bg-slate-800">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-white text-indigo-500 dark:bg-slate-900 dark:text-indigo-300">
            <FileText className="size-4" />
          </span>
          <p className="min-w-0 flex-1 truncate text-sm text-slate-900 dark:text-slate-100">{file.name}</p>
          <button
            type="button"
            aria-label="移除文件"
            onClick={onClear}
            disabled={disabled}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            onFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`flex w-full flex-col items-center gap-3 rounded-xl border border-dashed bg-slate-100 px-4 py-10 text-center transition-colors hover:border-indigo-400 hover:bg-slate-200 dark:bg-slate-900 dark:hover:bg-slate-800 ${
              dragging ? "border-indigo-400 bg-slate-200 dark:bg-slate-800" : "border-slate-400 dark:border-slate-700"
            }`}
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-white text-indigo-500 shadow-sm dark:bg-slate-800 dark:text-indigo-300">
              <FileUp className="size-5" />
            </span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">拖拽文件到这里，或点击选择</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">支持 PDF、PPTX</span>
          </button>
        </div>
      )}
    </div>
  );
}
