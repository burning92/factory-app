-- BOM g/ea 소수점 입력 허용 (예: 31.25)
-- 실행 전후 애플리케이션은 number(float)로 저장/조회합니다.

ALTER TABLE public.bom
  ALTER COLUMN bom_g_per_ea TYPE numeric(10,2) USING bom_g_per_ea::numeric(10,2);

ALTER TABLE public.bom
  DROP CONSTRAINT IF EXISTS bom_bom_g_per_ea_check;

ALTER TABLE public.bom
  ADD CONSTRAINT bom_bom_g_per_ea_check CHECK (bom_g_per_ea >= 0);
