/** Apps Script → POST /api/internal/ecount-production/sync */

export type RawEcountProductionRow = {
  movement_date?: string | null;
  item_name?: string | null;
  quantity?: string | number | null;
  movement_type?: string | null;
  external_ref?: string | null;
  [key: string]: unknown;
};

export type EcountProductionSyncPayload = {
  rows?: RawEcountProductionRow[] | null;
  /** 엑셀/메모장에서 복사한 탭 구분 전체 (일자-No, 품목명, 로트, 수량, 변동구분, …) */
  paste?: string | null;
  /** 선택: YYYY-MM-DD (포함) */
  dateFrom?: string | null;
  dateTo?: string | null;
  sourceRefreshedAt?: string | null;
};
