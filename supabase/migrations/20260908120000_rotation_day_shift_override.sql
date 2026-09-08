-- 09~19 대체근무: 그날 하루만 적용되는 근무조. 프로필 기본 근무조(rotation_workers.shift)는 그대로 둔다.

ALTER TABLE public.rotation_day_attendance
  ADD COLUMN IF NOT EXISTS shift_override TEXT;

COMMENT ON COLUMN public.rotation_day_attendance.shift_override IS
  '그날만 적용하는 근무조 "HHMM-HHMM". 비어 있으면 기본 근무조를 쓴다.';

NOTIFY pgrst, 'reload schema';
