-- 공정관리 점검일지(빵류): 제품별 토핑 원료중량체크 평균(g)
-- 단일 제품은 기존 topping_weight_check_g 유지, 복수 제품은 JSON 배열 저장

ALTER TABLE public.daily_process_control_bread_logs
  ADD COLUMN IF NOT EXISTS topping_weight_checks jsonb;

COMMENT ON COLUMN public.daily_process_control_bread_logs.topping_weight_checks IS
  '제품별 토핑 중량체크 평균(g). 형식: [{"product":"제품명","g":12.5},...]. 복수 생산 품목일 때 사용.';

NOTIFY pgrst, 'reload schema';
