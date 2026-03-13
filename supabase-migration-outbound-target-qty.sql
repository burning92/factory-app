-- 출고 입력 단계 수량을 production_logs(outbound_records)에 직접 저장
-- - target dough qty: dough_qty
-- - expected finished qty: finished_qty_expected (신규)

ALTER TABLE public.production_logs
  ADD COLUMN IF NOT EXISTS dough_qty INT;

ALTER TABLE public.production_logs
  ADD COLUMN IF NOT EXISTS finished_qty_expected INT;

