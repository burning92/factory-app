-- 플래닝 대분류 집계: 제품 베이스명 분류 (관리 페이지에서 CRUD)
-- 코드 내 기본 맵·휴리스틱보다 DB 행이 우선한다.

CREATE TABLE IF NOT EXISTS public.planning_product_classifications (
  base_name TEXT PRIMARY KEY,
  major TEXT NOT NULL CHECK (major IN ('pizza', 'bread', 'parbake_storage', 'parbake_sale', 'unclassified')),
  pizza_subtype TEXT NULL CHECK (
    pizza_subtype IS NULL OR pizza_subtype IN ('light', 'heavy', 'mini')
  ),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT planning_product_classifications_pizza_subtype_consistency CHECK (
    (major = 'pizza' AND pizza_subtype IS NOT NULL)
    OR (major <> 'pizza' AND pizza_subtype IS NULL)
  )
);

COMMENT ON TABLE public.planning_product_classifications IS
  '월간 플래닝 피자/브레드/파베이크 집계용 베이스 제품명 분류. 관리자급이 관리 페이지에서 편집.';

CREATE INDEX IF NOT EXISTS idx_planning_product_classifications_major
  ON public.planning_product_classifications (major);

DROP TRIGGER IF EXISTS set_planning_product_classifications_updated_at
  ON public.planning_product_classifications;
CREATE TRIGGER set_planning_product_classifications_updated_at
  BEFORE UPDATE ON public.planning_product_classifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.planning_product_classifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "planning_product_classifications_select"
  ON public.planning_product_classifications;
CREATE POLICY "planning_product_classifications_select"
  ON public.planning_product_classifications FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "planning_product_classifications_write_admin"
  ON public.planning_product_classifications;
CREATE POLICY "planning_product_classifications_write_admin"
  ON public.planning_product_classifications FOR ALL TO authenticated
  USING (public.is_admin_like())
  WITH CHECK (public.is_admin_like());

NOTIFY pgrst, 'reload schema';
