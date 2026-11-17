"use client";

import { useCallback, useEffect, useState } from "react";

import { HISTORY_LIMIT, readHistory, writeHistory, type HistoryRecord } from "@/lib/history";

export function useHistory() {
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setRecords(readHistory());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeHistory(records);
  }, [hydrated, records]);

  const addRecord = useCallback((record: HistoryRecord) => {
    setRecords((current) =>
      [record, ...current.filter((item) => item.id !== record.id)].slice(0, HISTORY_LIMIT),
    );
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setRecords((current) =>
      current.map((record) =>
        record.id === id ? { ...record, isFavorite: !record.isFavorite } : record,
      ),
    );
  }, []);

  return { records, addRecord, toggleFavorite };
}
