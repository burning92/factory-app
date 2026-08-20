-- 반차 오전/오후 출근 구분 (포지셔닝용). 기존 half는 그대로 유지.

ALTER TABLE public.production_plan_leaves
  DROP CONSTRAINT IF EXISTS production_plan_leaves_leave_type_check;

ALTER TABLE public.production_plan_leaves
  ADD CONSTRAINT production_plan_leaves_leave_type_check
  CHECK (leave_type IN ('annual', 'half', 'half_am', 'half_pm'));

ALTER TABLE public.planning_range_entries
  DROP CONSTRAINT IF EXISTS planning_range_entries_entry_type_check;

ALTER TABLE public.planning_range_entries
  ADD CONSTRAINT planning_range_entries_entry_type_check
  CHECK (entry_type IN ('annual', 'half', 'half_am', 'half_pm', 'other'));

COMMENT ON COLUMN public.production_plan_leaves.leave_type IS
  'annual=연차, half=반차(구분없음, 기존), half_am=반차(오전출근), half_pm=반차(오후출근)';

NOTIFY pgrst, 'reload schema';
