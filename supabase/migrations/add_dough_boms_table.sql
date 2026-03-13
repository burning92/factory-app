-- ============================================================
-- dough_boms: 도우 BOM (밀가루 1kg, 수분율 61% 기준 부재료 g)
-- ============================================================
-- 반죽사용량 입력 페이지의 도우 종류 드롭다운 및 베이커스 퍼센트 역산에 사용.
-- ============================================================

CREATE TABLE IF NOT EXISTS dough_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  weight_per_piece INTEGER NOT NULL,
  salt NUMERIC(10,2) NOT NULL DEFAULT 0,
  yeast NUMERIC(10,2) NOT NULL DEFAULT 0,
  oil NUMERIC(10,2) NOT NULL DEFAULT 0,
  sugar NUMERIC(10,2) NOT NULL DEFAULT 0,
  improver NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dough_boms_name ON dough_boms (name);

COMMENT ON TABLE dough_boms IS '도우 BOM: 밀가루 1kg(1000g), 수분율 61% 기준 부재료 투입량(g). 반죽사용량 입력 드롭다운 및 스마트 반죽 계산기 연동.';
COMMENT ON COLUMN dough_boms.name IS '도우 명칭 (예: 일반 130g)';
COMMENT ON COLUMN dough_boms.weight_per_piece IS '1개 중량(g)';
COMMENT ON COLUMN dough_boms.salt IS '소금 (g/1kg 밀가루)';
COMMENT ON COLUMN dough_boms.yeast IS '이스트 (g/1kg 밀가루)';
COMMENT ON COLUMN dough_boms.oil IS '올리브오일 (g/1kg 밀가루)';
COMMENT ON COLUMN dough_boms.sugar IS '설탕 (g/1kg 밀가루)';
COMMENT ON COLUMN dough_boms.improver IS '개량제 (g/1kg 밀가루)';

NOTIFY pgrst, 'reload schema';
