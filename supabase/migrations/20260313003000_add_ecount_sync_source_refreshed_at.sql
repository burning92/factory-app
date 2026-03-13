-- RAW 시트 마지막 갱신 시각 (이카운트에서 구글시트 덮어쓴 시각)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ecount_sync_status' AND column_name = 'source_refreshed_at'
  ) THEN
    ALTER TABLE public.ecount_sync_status ADD COLUMN source_refreshed_at TIMESTAMPTZ;
  END IF;
END $$;

COMMENT ON COLUMN public.ecount_sync_status.source_refreshed_at IS 'RAW 구글시트 마지막 갱신 시각. 동기화 시 payload.sourceRefreshedAt 으로 전달.';
