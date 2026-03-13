-- ============================================================
-- public.dough_logs: 반죽 사용량 기록 (사용일자 기준)
-- ============================================================
-- 반죽날짜, 사용일자, 원료별 사용량·LOT/소비기한 등 저장. 관리일지 출력 시 생산일자와 매칭.
-- ============================================================

DROP TABLE IF EXISTS public.dough_logs;

CREATE TABLE public.dough_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date DATE NOT NULL UNIQUE,
  author_name TEXT,
  dough_ingredients JSONB NOT NULL DEFAULT '{}',
  dust_oil JSONB NOT NULL DEFAULT '{}',
  dough_date DATE,
  meta JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dough_logs_usage_date ON public.dough_logs (usage_date);
CREATE INDEX idx_dough_logs_dough_date ON public.dough_logs (dough_date);

COMMENT ON TABLE public.dough_logs IS '반죽 사용량 기록. usage_date=사용일자(저장 기준일), dough_date=반죽날짜, meta=도우종류/목표수량/투입포대 등.';
COMMENT ON COLUMN public.dough_logs.usage_date IS '사용일자(저장 기준일). 관리일지 생산일자와 매칭.';
COMMENT ON COLUMN public.dough_logs.dough_ingredients IS '반죽원료: { 원료명: [{ 사용량_g, lot }] }.';
COMMENT ON COLUMN public.dough_logs.dust_oil IS '덧가루·덧기름: { 이름: [{ 사용량_g, lot }] }.';
COMMENT ON COLUMN public.dough_logs.dough_date IS '반죽날짜(1단계).';
COMMENT ON COLUMN public.dough_logs.meta IS '도우 종류, 목표 수량, 투입 포대 수 등 확장 정보.';

ALTER TABLE public.dough_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dough_logs_select" ON public.dough_logs FOR SELECT USING (true);
CREATE POLICY "dough_logs_insert" ON public.dough_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "dough_logs_update" ON public.dough_logs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dough_logs_delete" ON public.dough_logs FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
