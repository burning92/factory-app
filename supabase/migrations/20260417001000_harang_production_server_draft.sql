-- 하랑 생산입고 임시저장(서버)
-- - 사용자별 1건 draft 저장
-- - manager/admin만 접근 가능

CREATE TABLE IF NOT EXISTS public.harang_production_drafts (
  created_by UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  draft_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_harang_production_drafts_updated_at ON public.harang_production_drafts;
CREATE TRIGGER set_harang_production_drafts_updated_at
  BEFORE UPDATE ON public.harang_production_drafts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.harang_production_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "harang_production_drafts_select_own" ON public.harang_production_drafts;
DROP POLICY IF EXISTS "harang_production_drafts_write_own" ON public.harang_production_drafts;
CREATE POLICY "harang_production_drafts_select_own"
  ON public.harang_production_drafts FOR SELECT TO authenticated
  USING (public.can_write_harang_ops() AND created_by = auth.uid());
CREATE POLICY "harang_production_drafts_write_own"
  ON public.harang_production_drafts FOR ALL TO authenticated
  USING (public.can_write_harang_ops() AND created_by = auth.uid())
  WITH CHECK (public.can_write_harang_ops() AND created_by = auth.uid());

CREATE OR REPLACE FUNCTION public.upsert_harang_production_draft(
  p_draft_data JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;
  IF p_draft_data IS NULL OR jsonb_typeof(p_draft_data) <> 'object' THEN
    RAISE EXCEPTION '임시저장 데이터 형식이 올바르지 않습니다.';
  END IF;

  INSERT INTO public.harang_production_drafts (created_by, draft_data)
  VALUES (v_uid, p_draft_data)
  ON CONFLICT (created_by)
  DO UPDATE
  SET draft_data = EXCLUDED.draft_data,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_harang_production_draft()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
  v_data JSONB;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  SELECT draft_data
    INTO v_data
  FROM public.harang_production_drafts
  WHERE created_by = v_uid;

  RETURN v_data;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_harang_production_draft()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.';
  END IF;
  IF NOT public.can_write_harang_ops() THEN
    RAISE EXCEPTION '권한이 없습니다.';
  END IF;

  DELETE FROM public.harang_production_drafts
  WHERE created_by = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_harang_production_draft(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_harang_production_draft() TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_harang_production_draft() TO authenticated;

NOTIFY pgrst, 'reload schema';
