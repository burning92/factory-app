-- ============================================================
-- 예전 문자열 organization_code(armored, master) 완전 정리
-- 000/100/200 숫자 코드만 남기고, 연결 관계 유지
-- ============================================================

-- 1) armored: 100 행이 이미 있으면 armored 행에 연결된 데이터를 100으로 이전 후 armored 행 삭제
DO $$
DECLARE
  vid_armored UUID;
  vid_100 UUID;
BEGIN
  SELECT id INTO vid_armored FROM public.organizations WHERE organization_code = 'armored' LIMIT 1;
  SELECT id INTO vid_100 FROM public.organizations WHERE organization_code = '100' LIMIT 1;

  IF vid_armored IS NOT NULL AND vid_100 IS NOT NULL AND vid_armored != vid_100 THEN
    UPDATE public.profiles SET organization_id = vid_100 WHERE organization_id = vid_armored;
    DELETE FROM public.organization_ui_settings WHERE organization_id = vid_armored;
    DELETE FROM public.organizations WHERE id = vid_armored;
  ELSIF vid_armored IS NOT NULL AND vid_100 IS NULL THEN
    UPDATE public.organizations SET organization_code = '100', name = '아머드프레시' WHERE id = vid_armored;
  END IF;
END $$;

-- 2) master: 000 행이 이미 있으면 master 행에 연결된 데이터를 000으로 이전 후 master 행 삭제
DO $$
DECLARE
  vid_master UUID;
  vid_000 UUID;
BEGIN
  SELECT id INTO vid_master FROM public.organizations WHERE organization_code = 'master' LIMIT 1;
  SELECT id INTO vid_000 FROM public.organizations WHERE organization_code = '000' LIMIT 1;

  IF vid_master IS NOT NULL AND vid_000 IS NOT NULL AND vid_master != vid_000 THEN
    UPDATE public.profiles SET organization_id = vid_000 WHERE organization_id = vid_master;
    DELETE FROM public.organization_ui_settings WHERE organization_id = vid_master;
    DELETE FROM public.organizations WHERE id = vid_master;
  ELSIF vid_master IS NOT NULL AND vid_000 IS NULL THEN
    UPDATE public.organizations SET organization_code = '000', name = '시스템관리' WHERE id = vid_master;
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.organization_code IS '사람 입력/표시용 코드. 숫자형(000=시스템관리, 100=아머드프레시, 200=하랑 등).';

NOTIFY pgrst, 'reload schema';
