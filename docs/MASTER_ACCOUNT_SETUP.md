# Admin 계정 최초 생성

공개 회원가입이 없으므로, **첫 admin 계정**은 아래 둘 중 하나로 한 번만 생성합니다.

**방법 A: 스크립트 (권장)**  
프로젝트 루트에서 `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 있는 상태로:
```bash
# PowerShell
$env:INITIAL_ADMIN_PASSWORD = "원하는비밀번호"; node scripts/create-initial-admin.mjs
```
스크립트가 Auth 사용자(`YWRtaW4@000.local`) 생성 후 `profiles`에 `login_id=admin`, `role=admin` 행을 넣습니다. 이미 `role=admin`이 있으면 건너뜁니다.

**방법 B: Dashboard + SQL**

1. **Supabase Dashboard → Authentication → Users → Add user**
   - Email: `YWRtaW4@000.local` (login_id `admin`을 base64url한 local-part. 한글/특수문자 대응 체계와 동일)
   - Password: 강한 비밀번호 설정 (하드코딩 금지, 비밀번호 관리 도구로 보관)
   - 생성 후 해당 사용자의 **User UID** 복사

2. **SQL Editor에서 아래 실행** (마이그레이션으로 이미 `000` 조직이 있어야 함)

```sql
INSERT INTO public.profiles (id, organization_id, login_id, display_name, role, is_active, must_change_password)
VALUES (
  '<위에서 복사한 User UID>',
  (SELECT id FROM public.organizations WHERE organization_code = '000' LIMIT 1),
  'admin',
  '관리자',
  'admin',
  true,
  false
)
ON CONFLICT (id) DO NOTHING;
```

3. **로그인**
   - 회사코드: `000`
   - 아이디: `admin`
   - 비밀번호: 1단계에서 설정한 비밀번호

**회사코드 체계:** 000=admin, 100=아머드프레시, 200=하랑 등 숫자로 통일되어 있습니다.

이후 사용자/사업장 추가는 앱의 **관리 (사업장/사용자)** 화면에서 admin 계정으로 진행합니다.
