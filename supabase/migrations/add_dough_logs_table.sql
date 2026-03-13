-- ============================================================
-- dough_logs: 독립 반죽 사용량 테이블 (사용일자 기준, 제품 생산과 분리)
-- ============================================================
-- 사용일자(usage_date)가 유일 키. 관리일지 출력 시 생산일자와 매칭해 자동 조회.
-- ============================================================

CREATE TABLE IF NOT EXISTS dough_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date DATE NOT NULL UNIQUE,
  author_name TEXT,
  dough_ingredients JSONB NOT NULL DEFAULT '{}',
  dust_oil JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dough_logs_usage_date ON dough_logs (usage_date);

COMMENT ON TABLE dough_logs IS 'Dough usage by date (independent of product runs). usage_date = key for auto-join with production log date.';
COMMENT ON COLUMN dough_logs.usage_date IS 'Usage date (사용일자). Matched with production_date when printing journal.';
COMMENT ON COLUMN dough_logs.dough_ingredients IS '반죽원료: Record<ingredientName, DoughProcessLine[]>.';
COMMENT ON COLUMN dough_logs.dust_oil IS '덧가루덧기름: Record<name, DoughProcessLine[]>.';

NOTIFY pgrst, 'reload schema';
