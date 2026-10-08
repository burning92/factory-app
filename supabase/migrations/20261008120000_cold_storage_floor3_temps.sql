-- 냉장·냉동 온도 및 위생점검일지: 3층 숙성고(0~10℃), 3층 급속냉동고(-30℃ 이하) 오전/오후 측정값
ALTER TABLE public.daily_cold_storage_hygiene_logs
  ADD COLUMN IF NOT EXISTS am_temp_floor3_aging_c NUMERIC,
  ADD COLUMN IF NOT EXISTS am_temp_floor3_blast_freezer_c NUMERIC,
  ADD COLUMN IF NOT EXISTS pm_temp_floor3_aging_c NUMERIC,
  ADD COLUMN IF NOT EXISTS pm_temp_floor3_blast_freezer_c NUMERIC;
