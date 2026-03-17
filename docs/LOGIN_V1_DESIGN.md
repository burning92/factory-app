# 로그인 시스템 v1 설계 확정

## 숫자 회사코드 처리 방식

- **DB:** `organizations.organization_code`에 사람 입력/표시용 코드 저장. 숫자형은 문자열로 저장 (예: `'100'`, `'200'`). 내부 식별은 `organizations.id`(uuid)만 사용.
- **로그인 화면:** 회사코드 입력란에 **숫자만** 입력 (예: 100, 200). `inputMode="numeric"`으로 모바일에서 숫자 키패드 유도.
- **Lookup:** 로그인 시 `organization_code`로 조직 조회 후, 인증 이메일을 `로그인ID@organization_code.local` 형식으로 생성. 동일 코드가 다른 조직과 겹치지 않으므로 `organization_code`로 유일하게 조직을 찾을 수 있음.
- **시스템 관리:** admin 계정은 회사코드 **000**으로 로그인 (숫자 체계와 동일). 100, 200 등은 일반 사업장.

## 하랑 계정(하랑01 등)과 작성자 표시

- **로그인 ID:** 하랑은 실명이 아닌 `하랑01`, `하랑02` 형식 허용.
- **표시 이름(display_name):** 로그인 ID와 분리. admin이 사용자 생성 시 "표시 이름"을 별도 설정. 설정하지 않으면 null이며, 작성자 기본값은 **display_name 0순위 → 최근값 fallback**이므로 null이면 기존처럼 최근 작성자명/로컬 값이 채워짐.
- **정책:** 하랑01 계정이라도 admin이 display_name을 "하랑 1번 담당" 등으로 넣어 두면 그대로 작성자로 표시. 실명 강제가 아니며, 운영 정책에 따라 표시명만 설정하면 됨.

## login_id → Auth 이메일 변환 (한글 대응)

- **위험:** login_id를 그대로 이메일 local-part에 쓰면 한글 등 non-ASCII에서 Supabase Auth/이메일 규격 문제가 날 수 있음.
- **조치:** 사용자 입력용 `login_id`는 그대로 `profiles.login_id`에만 저장하고, **Auth 이메일에는 사용하지 않음.** 내부 이메일 local-part는 `toAuthEmailLocal(login_id)`(UTF-8 → base64url) 결과만 사용. `src/lib/authEmail.ts`에 정의되어 있으며, 로그인·사용자 생성 시 동일 함수로 변환해 이메일을 만듦.
- **정리:** 로그인 ID는 한글(홍길동01)·영문(harang01) 모두 허용하고, Auth에는 ASCII만 쓰므로 안전하게 동작.

## manager 권한 v1 기본안

- **admin:** 모든 메뉴 + "관리 (사업장/사용자)" 노출. 관리 기능 전부 사용 가능.
- **manager:** "관리" 메뉴는 **노출하지 않음**. 그 외 업무 메뉴(출고, 사용량 계산, 반죽사용량, 기준 정보 등)는 v1에서 **admin과 동일하게** 노출. 조회 중심 상위 권한은 추후 페이지별로 읽기 전용/수정 제한 등 세분화 예정.
- **worker:** v1에서는 manager와 동일한 메뉴 구성. 추후 세분화 시 일부 페이지만 노출하거나 제한할 수 있음.

구현: Header에서 "관리" 링크는 `profile.role === 'admin'`일 때만 표시. manager/worker는 동일한 DEFAULT_MENUS 또는 organization_ui_settings 기반 메뉴를 사용.

## 향후 role/permission 확장 초안

- **현재:** `profiles.role` = 'worker' | 'manager' | 'admin'. 권한 분기는 코드에서 role 비교로만 처리.
- **확장 시:**  
  - **옵션 A.** 역할별 노출 메뉴/경로를 설정 테이블로 보관 (예: `role_menu` 또는 `organization_ui_settings`에 역할별 메뉴 목록).  
  - **옵션 B.** `permissions` 테이블 도입 (예: `role`, `resource`, `action`)으로 "manager는 production_logs 조회만", "worker는 dough-usage 쓰기만" 등 세분화.  
- v1에서는 **역할 3종만** 두고, 메뉴 노출은 admin만 "관리" 추가, manager/worker는 동일. 추후 메뉴 단위 또는 페이지 단위로 `role`/`permission` 조건을 추가하면 됨.
