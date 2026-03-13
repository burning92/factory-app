-- ============================================================
-- production_history_date_state: 1차/2차 마감 날짜별 상태 (Supabase 기준)
-- ============================================================
-- history 페이지에서 날짜별 작업대기/1차마감완료/2차마감완료 상태 및
-- 작성자, 도우량, 원료/LOT, 2차 마감 데이터를 서버에 저장하여
-- 새로고침·다른 기기에서도 동일하게 표시되도록 함.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.production_history_date_state (
  production_date DATE NOT NULL PRIMARY KEY,
  first_closed_at TIMESTAMPTZ,
  second_closed_at TIMESTAMPTZ,
  author_name TEXT,
  state_snapshot JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

COMMENT ON TABLE public.production_history_date_state IS '1차/2차 마감 날짜별 상태. state_snapshot에 전체 DateGroupState JSON 저장.';
COMMENT ON COLUMN public.production_history_date_state.first_closed_at IS '1차 마감 저장 시각 (NULL이면 미마감)';
COMMENT ON COLUMN public.production_history_date_state.second_closed_at IS '2차 마감 저장 시각 (NULL이면 미마감)';
COMMENT ON COLUMN public.production_history_date_state.state_snapshot IS '날짜별 전체 상태 JSON (authorName, materials, secondClosure 등)';
COMMENT ON COLUMN public.production_history_date_state.updated_by IS '마지막 저장자(작성자명)';

CREATE INDEX IF NOT EXISTS idx_production_history_date_state_updated_at
  ON public.production_history_date_state (updated_at DESC);

ALTER TABLE public.production_history_date_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "production_history_date_state_all"
  ON public.production_history_date_state FOR ALL
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
