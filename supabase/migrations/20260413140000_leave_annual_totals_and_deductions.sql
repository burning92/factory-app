-- ============================================================
-- 연차: 연도별 발생 총량(관리자 ± 조정) + 차감 내역 누적
-- 잔여 = total_days − SUM(deductions.days)
-- 잘못 차감된 경우: 차감 행 삭제 또는 발생 총량을 +로 보정
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leave_annual_totals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  total_days NUMERIC(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (profile_id, year)
);

COMMENT ON TABLE public.leave_annual_totals IS '연도별 연차 발생 총량. 관리 화면에서 직접 수치 조정(±).';
COMMENT ON COLUMN public.leave_annual_totals.total_days IS '해당 연도 연차 발생 총일수(0.5일 등 소수 가능).';

CREATE INDEX IF NOT EXISTS idx_leave_annual_totals_profile_year
  ON public.leave_annual_totals (profile_id, year);

CREATE TABLE IF NOT EXISTS public.leave_deductions (
  id BIGSERIAL PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  year SMALLINT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  usage_date DATE NOT NULL,
  days NUMERIC(10, 2) NOT NULL CHECK (days > 0),
  memo TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.leave_deductions IS '연차 차감 누적(사용분). days만큼 발생 총량에서 차감.';
COMMENT ON COLUMN public.leave_deductions.year IS '집계·조회 편의용(usage_date 연도와 동일하게 맞출 것).';

CREATE INDEX IF NOT EXISTS idx_leave_deductions_profile_year
  ON public.leave_deductions (profile_id, year);

DROP TRIGGER IF EXISTS set_leave_annual_totals_updated_at ON public.leave_annual_totals;
CREATE TRIGGER set_leave_annual_totals_updated_at
  BEFORE UPDATE ON public.leave_annual_totals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.leave_annual_totals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_deductions ENABLE ROW LEVEL SECURITY;

-- 본인 조회 또는 admin 전체
CREATE POLICY "leave_annual_totals_select_own_or_admin"
  ON public.leave_annual_totals FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_annual_totals_insert_admin"
  ON public.leave_annual_totals FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_annual_totals_update_admin"
  ON public.leave_annual_totals FOR UPDATE
  TO authenticated
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_annual_totals_delete_admin"
  ON public.leave_annual_totals FOR DELETE
  TO authenticated
  USING (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_deductions_select_own_or_admin"
  ON public.leave_deductions FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_deductions_insert_admin"
  ON public.leave_deductions FOR INSERT
  TO authenticated
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_deductions_update_admin"
  ON public.leave_deductions FOR UPDATE
  TO authenticated
  USING (public.get_my_profile_role() = 'admin')
  WITH CHECK (public.get_my_profile_role() = 'admin');

CREATE POLICY "leave_deductions_delete_admin"
  ON public.leave_deductions FOR DELETE
  TO authenticated
  USING (public.get_my_profile_role() = 'admin');

NOTIFY pgrst, 'reload schema';
