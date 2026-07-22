-- profiles.role 허용값 확장: quality_manager(품질팀장) — admin급 운영 권한(+ 데일리 일지 승인)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('worker', 'assistant_manager', 'manager', 'quality_manager', 'headquarters', 'admin'));
