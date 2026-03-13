-- ============================================================
-- app_recent_values: 앱 최근값 key-value (cross-device 공유)
-- ============================================================
-- 출고 입력/1차 마감 등 "최근 작성자명"을 Supabase에 저장하여
-- 다른 기기·브라우저에서도 동일한 값이 표시되도록 함.
-- 키 예: outbound-last-author-name, first-close-last-author-name
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_recent_values (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_recent_values IS '앱 최근값 저장 (최근 작성자명 등). key별 1행.';
COMMENT ON COLUMN public.app_recent_values.key IS '구분 키. 예: outbound-last-author-name, first-close-last-author-name';
COMMENT ON COLUMN public.app_recent_values.value IS '저장할 값 (예: 작성자명)';
COMMENT ON COLUMN public.app_recent_values.updated_at IS '마지막 갱신 시각';

CREATE INDEX IF NOT EXISTS idx_app_recent_values_updated_at
  ON public.app_recent_values (updated_at DESC);

ALTER TABLE public.app_recent_values ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_recent_values_all"
  ON public.app_recent_values FOR ALL
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
