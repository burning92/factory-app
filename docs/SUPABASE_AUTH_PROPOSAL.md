# Supabase Auth 이메일/비밀번호 로그인 도입 제안안

## 1. 필요한 최소 테이블/필드

### 1.1 Supabase Auth (내장)

- **auth.users**: 이메일/비밀번호 가입 시 자동 생성
  - `id` (uuid), `email`, `encrypted_password`, `email_confirmed_at`, `raw_user_meta_data`(display_name 등), `created_at`, `updated_at`
- **auth.identities**: provider별 identity (email 로그인 시 1행)
- **auth.sessions**: 세션 저장 (persist 방식에 따라 사용)

### 1.2 앱 전용 프로필(선택)

- **public.profiles** (또는 `user_profiles`)
  - `id` (uuid, PK, auth.users.id FK)
  - `display_name` (text) — 화면에 표시할 이름, 작성자 자동표시용
  - `created_at`, `updated_at`
- RLS: `auth.uid() = id` 로 본인만 읽기/수정

가입 시 `auth.users.raw_user_meta_data`에만 `display_name` 넣고 프로필 테이블 없이 진행해도 됨. 나중에 확장 시 profiles 추가.

---

## 2. 로그인 유지(session persist) 방식

- **권장**: Supabase 기본 동작
  - 브라우저: `localStorage`에 세션 저장 (기본)
  - 옵션: `createClient(..., { auth: { persistSession: true, storage: localStorage } })` 또는 `sessionStorage`로 변경 가능
- 모바일/앱: `expo-secure-store` 등 안전 저장소와 연동 가능
- 세션 갱신: refresh token으로 자동 갱신; `onAuthStateChange`로 로그인/로그아웃/만료 처리

---

## 3. 가입한 이름으로 작성자 자동표시하는 연결 방식

- **가입/프로필**: 회원가입 시 `display_name`(또는 `raw_user_meta_data.full_name`) 저장
- **기본값 주입**: 이미 분리된 `getDefaultAuthorName()` 활용
  - 로그인된 경우: `supabase.auth.getUser()` → `user?.user_metadata?.display_name` 또는 `profiles.display_name` 반환
  - 미로그인: 기존처럼 Supabase `app_recent_values` → localStorage 순
- **저장 시**: 작성자명 저장 시 로그인 사용자면 해당 사용자 id/이름을 기록하고, `app_recent_values`/localStorage에도 동기화해 비로그인 기기·다른 기기에서의 fallback 유지

정리하면, `src/lib/authorDefault.ts`의 `getDefaultAuthorName(supabaseKey, localStorageKey)`에 선택 인자로 `user | null`을 넘기고, `user?.user_metadata?.display_name ?? (기존 Supabase → localStorage 로직)` 순으로 반환하면 작성자 자동표시를 로그인과 통일할 수 있음.
