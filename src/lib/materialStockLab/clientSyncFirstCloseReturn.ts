/**
 * 2차 마감 저장 후 Lab 연동: 잔량 반납(return_unused) + 베이스 폐기(waste).
 * 비동기·실패 무시.
 */
export type SecondCloseLabSyncBody =
  | {
      action: "upsert";
      production_date: string;
      state_snapshot: unknown;
    }
  | {
      action: "void";
      production_date: string;
    };

export type FirstCloseReturnLabSyncBody = SecondCloseLabSyncBody;

export async function requestSecondCloseLabSync(body: SecondCloseLabSyncBody): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { supabase } = await import("@/lib/supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch("/api/internal/material-stock-lab/sync-second-close", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* Lab 연동 실패는 마감 UX에 영향 없음 */
  }
}

/** @deprecated requestSecondCloseLabSync 사용 */
export const requestFirstCloseReturnLabSync = requestSecondCloseLabSync;
