-- 숙련도는 같은 값 여러 명 허용. 1~4 유일 순번 인덱스 제거.

DROP INDEX IF EXISTS public.rotation_priorities_unique_rank;

COMMENT ON TABLE public.rotation_priorities IS
  '작업자×제품군×포지션 숙련도(1 상, 2 중상, 3 중, 4 하, 5 비상, 0 불가). 같은 숙련 여러 명 가능.';

NOTIFY pgrst, 'reload schema';
