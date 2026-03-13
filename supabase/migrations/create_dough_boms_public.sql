-- ============================================================
-- public.dough_boms: 도우 BOM (1포대당 생산 수량 + 밀가루 1kg 기준 부재료)
-- ============================================================
-- Supabase SQL Editor에서 이 파일 내용을 실행하세요.
-- ============================================================

DROP TABLE IF EXISTS public.dough_boms;

CREATE TABLE public.dough_boms (
  id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  name TEXT NOT NULL,
  production_per_bag INT4 NOT NULL,
  salt FLOAT8 NOT NULL DEFAULT 0,
  yeast FLOAT8 NOT NULL DEFAULT 0,
  oil FLOAT8 NOT NULL DEFAULT 0,
  sugar FLOAT8 NOT NULL DEFAULT 0,
  improver FLOAT8 NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_dough_boms_name ON public.dough_boms (name);

COMMENT ON TABLE public.dough_boms IS '도우 BOM: 1포대당 생산 수량 + 밀가루 1kg 기준 부재료(g).';
COMMENT ON COLUMN public.dough_boms.production_per_bag IS '1포대(25kg)당 생산 수량(개)';
COMMENT ON COLUMN public.dough_boms.salt IS '소금 배합량 (g/1kg 밀가루)';
COMMENT ON COLUMN public.dough_boms.yeast IS '이스트 배합량 (g/1kg 밀가루)';
COMMENT ON COLUMN public.dough_boms.oil IS '올리브오일 배합량 (g/1kg 밀가루)';
COMMENT ON COLUMN public.dough_boms.sugar IS '설탕 배합량 (g/1kg 밀가루)';
COMMENT ON COLUMN public.dough_boms.improver IS '개량제 배합량 (g/1kg 밀가루)';

-- RLS: 읽기/쓰기 허용 (일시적으로 비활성화하여 anon/service_role 모두 접근 가능)
ALTER TABLE public.dough_boms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dough_boms_select" ON public.dough_boms FOR SELECT USING (true);
CREATE POLICY "dough_boms_insert" ON public.dough_boms FOR INSERT WITH CHECK (true);
CREATE POLICY "dough_boms_update" ON public.dough_boms FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "dough_boms_delete" ON public.dough_boms FOR DELETE USING (true);

NOTIFY pgrst, 'reload schema';
