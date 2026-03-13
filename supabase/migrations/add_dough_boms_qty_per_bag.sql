-- ============================================================
-- dough_boms: 1포대(25kg)당 생산 수량(개) 컬럼 추가
-- ============================================================
-- 현장 실무: 로스율 포함 '1포대당 300개' 등 실측 기준으로 권장 포대 수 계산에 사용.
-- weight_per_piece는 유지하되 nullable로 변경 (신규 등록은 qty_per_bag만 사용).
-- ============================================================

ALTER TABLE dough_boms
  ADD COLUMN IF NOT EXISTS qty_per_bag INTEGER NOT NULL DEFAULT 0;

ALTER TABLE dough_boms
  ALTER COLUMN weight_per_piece DROP NOT NULL,
  ALTER COLUMN weight_per_piece SET DEFAULT 0;

COMMENT ON COLUMN dough_boms.qty_per_bag IS '1포대(25kg)당 생산 수량(개). 권장 포대 수 = 목표 수량 / 본 값.';

NOTIFY pgrst, 'reload schema';
