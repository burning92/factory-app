/**
 * 원료 입고 검수 저장 후 Lab receipt 연동 (비동기·실패 무시).
 */
export type MaterialReceiptLabSyncBody =
  | {
      action: "upsert";
      inspection_log_id: string;
      received_at: string;
      lines: {
        line_index: number;
        item_name: string;
        total_weight_g: number;
        conformity: "O" | "X" | string;
      }[];
    }
  | {
      action: "void";
      inspection_log_id: string;
    };

export async function requestMaterialReceiptLabSync(body: MaterialReceiptLabSyncBody): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { supabase } = await import("@/lib/supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch("/api/internal/material-stock-lab/sync-material-receipt", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* Lab 연동 실패는 입고 검수 UX에 영향 없음 */
  }
}
