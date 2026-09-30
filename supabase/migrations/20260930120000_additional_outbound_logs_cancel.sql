-- 추가 출고 내역: 생산 출고 현황에서 LOT 삭제 시 내역을 삭제됨으로 표시

ALTER TABLE public.additional_outbound_logs
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by_name TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.additional_outbound_logs.cancelled_at IS '출고 라인 삭제로 취소된 시각 (NULL이면 유효)';

DROP POLICY IF EXISTS "additional_outbound_logs_update" ON public.additional_outbound_logs;
CREATE POLICY "additional_outbound_logs_update"
  ON public.additional_outbound_logs FOR UPDATE TO authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
