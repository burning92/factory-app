# 마스터 계정 최초 생성

공개 회원가입이 없으므로, **첫 마스터 계정**은 Supabase Dashboard와 SQL로 한 번만 생성합니다.

1. **Supabase Dashboard → Authentication → Users → Add user**
   - Email: `admin@master.local` (또는 원하는 로그인 아이디에 맞춰 `로그인아이디@master.local`)
   - Password: 강한 비밀번호 설정 (하드코딩 금지, 비밀번호 관리 도구로 보관)
   - 생성 후 해당 사용자의 **User UID** 복사

2. **SQL Editor에서 아래 실행** (마이그레이션으로 이미 `master` 조직이 있어야 함)

```sql
INSERT INTO public.profiles (id, organization_id, login_id, display_name, role, is_active, must_change_password)
VALUES (
  '<위에서 복사한 User UID>',
  (SELECT id FROM public.organizations WHERE organization_code = 'master' LIMIT 1),
  'admin',
  '관리자',
  'master',
  true,
  false
)
ON CONFLICT (id) DO NOTHING;
```

3. **로그인**
   - 회사코드: `master`
   - 아이디: `admin`
   - 비밀번호: 1단계에서 설정한 비밀번호

이후 사용자/사업장 추가는 앱의 **관리 (사업장/사용자)** 화면에서 마스터 계정으로 진행합니다.
