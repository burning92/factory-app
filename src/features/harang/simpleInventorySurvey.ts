import { supabase } from "@/lib/supabase";
import type { HarangCategory } from "@/features/harang/types";

export type InventorySurveyRow = {
  id: string;
  survey_date: string;
  title: string | null;
  status: "draft" | "confirmed";
  note: string | null;
  created_at: string;
  confirmed_at: string | null;
};

export type InventorySurveyLineRow = {
  id: string;
  survey_id: string;
  lot_id: string;
  category: HarangCategory;
  item_id: string;
  item_code: string;
  item_name: string;
  lot_date: string;
  unit: string;
  physical_qty: number;
};

export type SurveyConsumptionReportRow = {
  period_label: string;
  prev_survey_id: string;
  prev_survey_date: string;
  curr_survey_id: string;
  curr_survey_date: string;
  category: string;
  item_id: string;
  item_name: string;
  unit: string;
  lot_date: string;
  prev_physical: number;
  period_inbound: number;
  curr_physical: number;
  calculated_consumption: number;
};

export type SurveyMonthlyItemRow = {
  month_label: string;
  category: string;
  item_id: string;
  item_name: string;
  unit: string;
  total_consumption: number;
  month_end_stock: number;
  last_survey_date: string;
};

export function formatYmdDot(iso: string): string {
  return iso ? iso.slice(0, 10).replaceAll("-", ".") : "";
}

export function formatPeriodLabel(prev: string, curr: string): string {
  return `${formatYmdDot(prev)} ~ ${formatYmdDot(curr)}`;
}

/** 실사 기준 계산 소모량 (클라이언트 검증용) */
export function calcSurveyConsumption(prev: number, inbound: number, current: number): number {
  return Math.round((prev + inbound - current) * 1000) / 1000;
}

export type SimpleInventoryLotReference = {
  lotId: string;
  /** 최신 확정 조사 snapshot + 이후 inbound. 첫 조사 전이면 inbound 누적만. */
  referenceQty: number;
  hasBaselineSurvey: boolean;
  baselineSurveyDate: string | null;
};

/**
 * 간편 재고 입력 화면용 참고 수량 (읽기 전용).
 * current_quantity·usage 원장은 사용하지 않습니다.
 */
export async function loadSimpleInventoryLotReferences(): Promise<Map<string, SimpleInventoryLotReference>> {
  const result = new Map<string, SimpleInventoryLotReference>();

  const surveyRes = await supabase
    .from("harang_inventory_surveys")
    .select("id, survey_date")
    .eq("status", "confirmed")
    .order("survey_date", { ascending: false })
    .limit(1);

  if (surveyRes.error) throw new Error(surveyRes.error.message);

  const latest = surveyRes.data?.[0] as { id: string; survey_date: string } | undefined;
  const baselineDate = latest?.survey_date ?? null;

  const snapshotByLot = new Map<string, number>();
  if (latest) {
    const linesRes = await supabase
      .from("harang_inventory_survey_lines")
      .select("lot_id, physical_qty")
      .eq("survey_id", latest.id);
    if (linesRes.error) throw new Error(linesRes.error.message);
    for (const row of linesRes.data ?? []) {
      snapshotByLot.set(row.lot_id as string, Number(row.physical_qty));
    }
  }

  const txRes = await supabase
    .from("harang_inventory_transactions")
    .select("lot_id, quantity_delta, tx_date, tx_type");
  if (txRes.error) throw new Error(txRes.error.message);

  const inboundByLot = new Map<string, number>();
  for (const tx of txRes.data ?? []) {
    if (!tx.lot_id || tx.tx_type !== "inbound") continue;
    const d = String(tx.tx_date).slice(0, 10);
    if (baselineDate && d <= baselineDate) continue;
    const lotId = tx.lot_id as string;
    inboundByLot.set(lotId, (inboundByLot.get(lotId) ?? 0) + Number(tx.quantity_delta));
  }

  if (!baselineDate) {
    inboundByLot.forEach((inbound, lotId) => {
      result.set(lotId, {
        lotId,
        referenceQty: Math.round(inbound * 1000) / 1000,
        hasBaselineSurvey: false,
        baselineSurveyDate: null,
      });
    });
    return result;
  }

  const allLotIds = Array.from(snapshotByLot.keys());
  inboundByLot.forEach((_, lotId) => {
    if (!allLotIds.includes(lotId)) allLotIds.push(lotId);
  });
  for (const lotId of allLotIds) {
    const base = snapshotByLot.get(lotId) ?? 0;
    const inbound = inboundByLot.get(lotId) ?? 0;
    result.set(lotId, {
      lotId,
      referenceQty: Math.round((base + inbound) * 1000) / 1000,
      hasBaselineSurvey: true,
      baselineSurveyDate: baselineDate,
    });
  }

  return result;
}
