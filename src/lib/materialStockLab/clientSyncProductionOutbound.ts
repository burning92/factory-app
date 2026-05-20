/**
 * production_logs 저장 후 Lab movement 연동 (비동기·실패 무시).
 * 출고 본 저장이 실패하지 않도록 예외를 삼킵니다.
 */
export type ProductionOutboundLabSyncBody =
  | {
      action: "upsert";
      production_log_id: string;
      production_date: string;
      material_name: string;
      outbound_g: number;
      product_name?: string | null;
    }
  | {
      action: "void";
      production_log_id: string;
    };

export async function requestProductionOutboundLabSync(body: ProductionOutboundLabSyncBody): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { supabase } = await import("@/lib/supabase");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    await fetch("/api/internal/material-stock-lab/sync-production-outbound", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-refresh-token": session.refresh_token ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    /* Lab 연동 실패는 출고 UX에 영향 없음 */
  }
}
