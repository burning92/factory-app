-- profiles.role 허용값 확장: headquarters(본사), assistant_manager(준매니저)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('worker', 'assistant_manager', 'manager', 'headquarters', 'admin'));
