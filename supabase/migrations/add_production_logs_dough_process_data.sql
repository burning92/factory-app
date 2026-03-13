-- ============================================================
-- production_logs: 도우 반죽 공정 입력 데이터 (JSONB)
-- ============================================================
-- 반죽날짜, 사용일자, 작성자명, 반죽원료/덧가루덧기름 LOT별 사용량
-- ============================================================

ALTER TABLE production_logs ADD COLUMN IF NOT EXISTS dough_process_data JSONB;

NOTIFY pgrst, 'reload schema';
