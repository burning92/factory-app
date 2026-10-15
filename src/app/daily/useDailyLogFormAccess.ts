"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { getDailyLogAccessOrNew, type DailyLogAccessRow } from "@/app/daily/dailyLogPermissions";
import { assertDailyLogWritable } from "@/features/daily/logWorkflow";

/**
 * 작성·수정 화면 공통: 불러온 일지의 상태·작성자로 입력 가능 여부를 정하고,
 * 저장·제출 직전에 assertWritable(id) 로 DB 최신 상태를 다시 확인한다.
 * statusHint 가 바뀌면(저장·제출 후) 다시 읽는다.
 */
export function useDailyLogFormAccess(table: string, logId: string | null | undefined, statusHint?: string | null) {
  const { user, profile } = useAuth();
  const [row, setRow] = useState<DailyLogAccessRow | null>(null);

  useEffect(() => {
    if (!logId) {
      setRow(null);
      return;
    }
    let alive = true;
    supabase
      .from(table)
      .select("*")
      .eq("id", logId)
      .maybeSingle()
      .then(({ data }) => {
        if (alive) setRow((data as DailyLogAccessRow | null) ?? null);
      });
    return () => {
      alive = false;
    };
  }, [table, logId, statusHint]);

  const assertWritable = useCallback(
    (id: string) => assertDailyLogWritable(supabase, table, id, user?.id, profile?.role),
    [table, user?.id, profile?.role]
  );

  return { access: getDailyLogAccessOrNew(row, user?.id, profile?.role), assertWritable };
}
