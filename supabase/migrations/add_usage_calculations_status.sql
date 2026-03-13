-- ============================================================
-- usage_calculations: 단계별 상태(status) 컬럼 추가
-- ============================================================
-- draft: 작성 중, stock_entered: 재고입력완료, closed: 최종마감
-- 출고완료는 production_logs 존재 여부로 판단
-- ============================================================

ALTER TABLE public.usage_calculations
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE public.usage_calculations
  ADD CONSTRAINT usage_calculations_status_check
  CHECK (status IN ('draft', 'stock_entered', 'closed'));

COMMENT ON COLUMN public.usage_calculations.status IS 'draft=작성 중, stock_entered=재고입력완료, closed=최종마감';

NOTIFY pgrst, 'reload schema';
