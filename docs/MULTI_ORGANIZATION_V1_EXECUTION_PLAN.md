# 멀티 사업장 v1 실행계획

설계 초안(`MULTI_ORGANIZATION_DESIGN_DRAFT.md`)을 기준으로, **v1에서 실제로 구현할 범위**와 **작업 단위·위험·롤백·첫 배치 추천**만 정리한 실행계획 문서이다. 구현/커밋/배포는 별도 단계에서 진행한다.

---

## 1. v1 범위 — 이번에 실제로 구현할 것

| 항목 | v1 구현 내용 |
|------|----------------|
| **Supabase Auth 로그인** | 이메일/비밀번호 로그인·회원가입·세션 유지. 로그인/로그아웃 화면, 라우트 보호(미로그인 시 로그인 페이지로). |
| **profiles 연동** | `auth.users` 가입 시 또는 최초 로그인 시 `profiles` 행 생성(트리거 또는 앱 로직). `organization_id`, `display_name`, `role` 로드 후 클라이언트/API에서 사용. |
| **organization_id 최소 적용 대상 테이블** | v1에서는 **필수 최소만** 적용. `organizations` 테이블 생성 + 초기 1개 조직(예: armored). 비즈니스 테이블은 **첫 배치에서는 organization_id 미적용**으로 두고, 로그인·profiles·작성자 연동만 먼저 넣을 수 있음(아래 6절 추천 참고). 이후 단계에서 `dough_logs`, `production_logs` 등에 `organization_id` 추가. |
| **작성자 자동입력 로그인 연동** | `getDefaultAuthorName()` 등에 “로그인 사용자 있으면 `profiles.display_name`(또는 user_metadata) 반환” 로직 추가. 반죽사용량·출고·1차 마감 등 작성자 필드에 동일하게 적용. 수동 수정은 허용(설계 초안 5.1 정책). |
| **admin 통합 조회 범위** | v1에서는 **역할만 구분**(worker/manager/admin). admin일 때 “전체 조직 조회” UI·API는 **v1 후반 또는 v1.1**에서 구현 가능. 첫 배치에서는 admin 계정 존재·role 판별만 하고, 통합 대시/비교 화면은 제외 가능. |
| **조직별 UI/페이지 분기** | 로그인 사용자 `organization_id` 기준으로 **공통 앱 + organization별 UI 설정 분기**. 앱을 두 개로 완전 분리하지 않고, 레이아웃·라우트는 공유하고 로고·색상·메뉴·홈 카드·페이지 노출만 설정값으로 분기(아래 1.1절). |

- **정리:** v1 범위는 “로그인 + profiles + organization scope + 작성자 자동입력 연동 + role 구분 + **조직별 기본 브랜딩/메뉴 분기**”까지. admin 통합 조회·RLS 전면 적용은 작업 단위에 따라 1단계에서 제외하고 2단계로 미룰 수 있음.

### 1.1 로그인 후 조직별 페이지 컨셉·구성 분기 (공통 앱 + 설정 분기)

- **원칙:** 처음부터 앱을 조직별로 **완전히 두 개로 나누지 않는다**. **공통 앱 하나**를 유지하고, **organization별 설정값**으로 UI만 분기한다.
- **로그인 사용자 `organization_id` 기준으로 달라질 수 있는 것:**

| 구분 | 내용 | v1 적용 |
|------|------|--------|
| 로고 | 헤더/사이드바 등에 노출할 로고 이미지 URL | ✅ |
| 브랜드명/표시명 | 앱 상단·타이틀에 쓸 이름 (예: 아머드프레시 / 하랑) | ✅ |
| 메인 색상 | primary/강조 색상 (hex 등). 버튼·링크·포커스 링 등 | ✅ |
| 홈 대시보드 카드 구성 | 홈 화면에 어떤 카드(생산·반죽·출고 등)를 어떤 순서로 노출할지 | ✅ |
| 좌측/상단 메뉴 구성 | 메뉴 항목 목록·순서·라벨. 조직마다 다른 메뉴 세트 가능 | ✅ |
| 기본 랜딩 페이지 | 로그인 후 첫 진입 경로 (예: / vs /production/dough-logs) | ✅ (선택) |
| 페이지별 노출 여부 | 특정 경로를 해당 조직에만 노출하거나 숨김 (접근 제어) | ✅ |
| 문구/라벨명 | 화면 내 버튼·필드 라벨 등 조직별 문구 | v1 후반 또는 2단계(필요 시) |

- **v1 추천 방식:**
  - **공통 레이아웃 유지.** 하나의 레이아웃 컴포넌트에서 `organization_id`로 설정만 조회해 적용.
  - **organization별 설정값으로 메뉴·대시보드·브랜딩만 분기.** (로고 URL, 브랜드명, 메인 색상, 메뉴 항목/순서, 홈 카드 목록/순서)
  - **진짜 많이 다른 화면만** 후순위로 organization별 전용 컴포넌트 분기. v1에서는 가능한 한 설정(데이터)으로만 처리.

#### 1.1.1 저장 구조: organizations vs organization_ui_settings

| 방식 | 장점 | 단점 |
|------|------|------|
| **organizations 테이블에 컬럼 추가** | 조회 1회로 조직 정보+UI 설정 동시 로드. 스키마 단순. | 컬럼 수 늘어나면 organizations가 비대해짐. UI 전용 필드와 핵심 식별 필드가 섞임. |
| **별도 organization_ui_settings 테이블** | 조직 핵심 정보(organizations)와 UI 설정 분리. UI 필드 추가·변경 시 마이그레이션 영향이 설정 테이블로 한정. 확장 시 유리. | 조회 시 join 또는 2번 조회 필요. |

- **v1 권장:** **별도 `organization_ui_settings` 테이블**로 두는 것을 권장. `organizations`는 id, organization_code, name, is_active 등 **핵심만** 유지하고, 브랜딩·메뉴·카드 등은 전부 `organization_ui_settings`에 두면, 나중에 “테마 빌더”나 필드 추가 시 설계가 깔끔해짐.
- **organization_ui_settings 제안 구조 (v1용 최소):**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| organization_id | uuid, PK, FK → organizations | 1:1 (한 조직당 1행) |
| logo_url | text, nullable | 로고 이미지 URL |
| brand_name | text | 브랜드/표시명 (헤더·타이틀용) |
| primary_color | text, nullable | 메인 색상 hex (예: #0ea5e9) |
| menu_config | jsonb, nullable | 메뉴 항목·순서·라벨·경로·노출 여부. 예: `[{ "key": "dough", "label": "반죽", "path": "/production/dough-logs", "visible": true }, ...]` |
| home_cards_config | jsonb, nullable | 홈 대시보드 카드 목록·순서. 예: `[{ "key": "production", "visible": true, "order": 1 }, ...]` |
| default_landing_path | text, nullable | 로그인 후 첫 진입 경로 (기본값 `/` 등) |
| created_at, updated_at | timestamptz | |

- **v1에서 실제로 할 범위 / 안 할 범위:**

| 할 것 | 안 할 것 |
|-------|----------|
| 로고(URL), 브랜드명, 메인 색상 | 조직별 **완전 별도 앱** (별 도메인·별 빌드) |
| 메뉴 구성(설정 기반 분기) | **대규모 화면 복제** (조직마다 페이지 컴포넌트를 따로 두는 것) |
| 홈 화면 카드 구성(설정 기반 분기) | **복잡한 테마 빌더** (관리자가 색상·폰트를 UI에서 자유 편집하는 기능) |
| 페이지 접근 제어(메뉴/라우트에서 노출 여부) | |

---

## 2. v1에서 하지 않는 것

| 항목 | 설명 |
|------|------|
| **user_organizations** | 다대다 소속 테이블. v1은 1인 1회사(profiles.organization_id만 사용). |
| **복수 조직 소속** | 한 사용자가 여러 organization에 동시 소속. v1 미지원. |
| **고급 권한 관리** | 역할별 세부 권한(화면/API 단위 세밀 제어). v1은 worker/manager/admin 3종만. |
| **조직 전환 UI 고도화** | “현재 조직 선택” 드롭다운·다중 조직 전환. v1은 단일 소속만 있으므로 전환 UI 불필요. |
| **조직별 완전 별도 앱** | 앱을 조직마다 별 도메인·별 빌드로 완전 분리. v1은 공통 앱 + 설정 분기만. |
| **대규모 화면 복제** | 조직마다 페이지/컴포넌트를 따로 두는 방식. v1은 공통 컴포넌트 + 설정값 분기만. |
| **복잡한 테마 빌더** | 관리자가 UI에서 색상·폰트·레이아웃을 자유 편집하는 기능. v1은 고정 필드(로고·색상·메뉴 등)만. |

---

## 3. 마이그레이션 순서 — 작업 단위로 분리

### 3.1 SQL 단계

| 순서 | 작업 | 산출물 |
|------|------|--------|
| S1 | `organizations` 테이블 생성, 초기 1건 삽입(예: code=`armored`, name=아머드프레시) | migration 파일 |
| S1b | `organization_ui_settings` 테이블 생성(organization_id, logo_url, brand_name, primary_color, menu_config, home_cards_config, default_landing_path). S1 조직 1건에 대해 1행 삽입. | migration 파일 |
| S2 | `profiles` 테이블 생성 (id, organization_id, display_name, role, is_active, created_at, updated_at). auth.users.id FK. | migration 파일 |
| S3 | 기존 `auth.users`가 있으면 profiles 행 생성(배치 또는 트리거). organization_id = S1의 조직 id, role = `worker` 등 기본값. | migration 또는 스크립트 |
| S4 | (2단계) 비즈니스 테이블에 `organization_id` 추가. 기본값 설정 → NOT NULL 추가 → FK·인덱스. 기존 행은 기본 조직 id로 업데이트. | migration 파일들 |
| S5 | (2단계) `app_recent_values`에 `organization_id`, `user_id` nullable 추가. 기존 데이터 기본 조직·user_id NULL로 이전. | migration 파일 |
| S6 | (2단계) RLS 활성화 및 정책 추가. 테이블별 SELECT/INSERT/UPDATE/DELETE 조건. | migration 파일 |

- v1 “첫 배치”에서는 S1～S1b～S2～S3까지만 적용하고, S4～S6는 2단계로 미룸(아래 6절).

### 3.2 서버/API 단계

| 순서 | 작업 | 산출물 |
|------|------|--------|
| A1 | Supabase Auth 연동. 로그인/로그아웃/회원가입 API 또는 서버 액션. | API/라우트 또는 server actions |
| A2 | 로그인 성공 시 또는 세션 검사 시 `profiles` 조회. organization_id, display_name, role을 세션/쿠키/클라이언트 상태로 전달. **organization_ui_settings** 조회(organization_id 기준) 후 브랜딩·메뉴·홈 카드 설정 전달. | 미들웨어 또는 API |
| A3 | 작성자 기본값 제공 API 또는 헬퍼. `auth.getUser()` + profiles 조회 후 display_name 반환. (기존 getDefaultAuthorName 확장) | 공용 함수/API |
| A4 | (2단계) 비즈니스 API에서 모든 읽기/쓰기에 `organization_id` 필터·삽입. RLS와 이중으로 방어. | store/API 수정 |
| A5 | (2단계) admin 전용 “전체 조직” 조회 API. role=admin일 때만 organization_id 조건 생략. | API 확장 |

### 3.3 클라이언트 단계

| 순서 | 작업 | 산출물 |
|------|------|--------|
| C1 | 로그인/로그아웃/회원가입 화면. 라우트 보호(미로그인 시 로그인으로 리다이렉트). | 페이지·컴포넌트 |
| C2 | 전역 상태 또는 컨텍스트에 user + profile(organization_id, display_name, role) + **organization_ui_settings**(로고·브랜드명·색상·메뉴·홈 카드·기본 랜딩) 보관. | context/store |
| C3 | **공통 레이아웃**에서 설정 기반 분기: 로고 URL, 브랜드명, primary 색상(CSS 변수 등), 메뉴 항목/순서, 홈 카드 구성. 페이지 접근 제어(메뉴에 없거나 visible=false인 경로는 리다이렉트 또는 숨김). | 레이아웃·사이드바·홈 페이지 |
| C4 | 반죽사용량·출고·1차 마감 등 작성자 입력 시: 로그인 사용자 이름 자동 주입(getDefaultAuthorName 확장). 수동 수정 허용. | dough-usage, outbound, history 등 |
| C5 | (2단계) 모든 데이터 조회/저장 시 organization_id 전달 또는 서버에서 자동 주입. | store/훅 수정 |
| C6 | (2단계) admin 전용 “통합 조회” 메뉴·화면. | 페이지·네비게이션 |

### 3.4 검증 단계

| 순서 | 작업 | 확인 내용 |
|------|------|-----------|
| V1 | 로그인 플로우 | 가입·로그인·로그아웃·세션 유지·만료 후 리다이렉트 |
| V2 | profiles 연동 | 로그인 후 display_name·role·organization_id 노출(개발용 표시 가능) |
| V2b | 조직별 UI 분기 | organization_ui_settings 로드 후 로고·브랜드명·색상·메뉴·홈 카드가 조직별로 다르게 보이는지 |
| V3 | 작성자 자동입력 | 반죽사용량 등에서 로그인 사용자 이름이 기본값으로 들어가는지, 수동 수정 후 저장되는지 |
| V4 | (2단계) organization_id 적용 테이블 | 조회/저장 시 해당 조직 데이터만 노출·변경되는지 |
| V5 | (2단계) RLS | 비로그인·타 조직 접근 시 차단되는지, admin은 전체 조회 가능한지 |

---

## 4. 위험요소와 롤백 포인트

| 위험 | 내용 | 완화·롤백 |
|------|------|-----------|
| **organization_id 추가 시 기존 데이터** | 기존 테이블에 NOT NULL로 넣으면 기존 행이 비어 있음. 마이그레이션 전에 “기본 조직” 1개를 정하고, **모든 기존 행에 해당 organization_id를 UPDATE**한 뒤 컬럼 추가. 롤백: migration down에서 organization_id 컬럼 제거(데이터는 이미 단일 조직 가정). | S4에서 기본값 채우기 → ALTER. 롤백 시 해당 migration revert. |
| **RLS 적용 시 조회 막힘** | RLS를 켜는 순간 정책이 없거나 잘못되면 **모든 조회가 빈 결과**가 될 수 있음. | RLS는 **2단계**에서 적용. 적용 전에 정책을 “허용 조건” 위주로 작성하고, 스테이징에서 먼저 테스트. 롤백: RLS 비활성화 또는 정책 DROP 후 재적용. |
| **기존 작성자 자동입력과 로그인 이름 충돌** | 현재는 “최근 작성자”(app_recent_values/localStorage)를 기본값으로 씀. 로그인 도입 후 “로그인 사용자 이름”을 1순위로 바꾸면, **같은 기기에서 다른 사람이 로그인했을 때** 이전 사용자 이름이 남아 있으면 혼동 가능. | 정책: **로그인 사용자 있으면 항상 그 사람 이름을 1순위**로 사용. 최근 작성자(app_recent_values)는 “미로그인 fallback” 또는 “수동 입력 이력”으로만 사용. 구현 시 getDefaultAuthorName(user) → user ? user.display_name : (기존 Supabase/localStorage) 순서로 명확히 함. 롤백: 로그인 연동 제거하고 기존 getDefaultAuthorName(supabaseKey, storageKey)만 쓰도록 revert. |

- **롤백 포인트 요약:**  
  - **첫 배치:** 로그인·profiles·작성자 연동만 넣었으므로, Auth 비활성화·라우트 보호 제거·getDefaultAuthorName에서 user 분기 제거하면 이전 동작으로 복귀 가능.  
  - **2단계(organization_id·RLS):** 해당 migration down 및 API/클라이언트에서 organization_id 전달 제거.

---

## 5. 첫 구현 배치 추천 (1개만)

- **추천:** **로그인 + profiles + organization scope + 반죽사용량 작성자 자동입력 + organization별 기본 브랜딩/메뉴 분기**까지 한 번에 구현한다.
- **포함:**  
  - Supabase Auth 이메일/비밀번호 로그인·로그아웃·회원가입.  
  - `organizations` 1건 + `organization_ui_settings` 1건, `profiles` 테이블 및 로그인 시 프로필·**UI 설정** 로드.  
  - **organization scope:** 로그인 사용자 `organization_id` 기준으로 현재 조직 고정. (비즈니스 테이블에 organization_id 컬럼 넣는 것은 2단계)  
  - 반죽사용량 입력 화면에서 작성자 기본값: **로그인 사용자 display_name** → 없으면 기존처럼 Supabase `dough-last-author-name` → localStorage. 저장 시 작성자명·(선택) 작성자_user_id 기록.  
  - **organization별 기본 브랜딩/메뉴 분기:** 공통 레이아웃에서 `organization_ui_settings` 기반으로 로고·브랜드명·메인 색상·메뉴 구성·홈 대시보드 카드 구성·(선택) 기본 랜딩 경로·페이지 노출 여부 적용.  
- **제외(첫 배치에서 하지 않음):**  
  - 비즈니스 테이블에 organization_id 추가·RLS 적용.  
  - 출고·1차 마감 등 다른 화면 작성자 연동(2단계에서 동일 패턴으로 확장).  
  - admin 통합 조회 UI.  
  - 조직별 완전 별도 앱·대규모 화면 복제·복잡한 테마 빌더.  
- **이유:** 제안한 순서(로그인 → profiles → organization scope → 작성자 연동 → 조직별 UI 분기)를 한 배치로 묶어, “한 번 로그인하면 조직에 맞는 브랜딩·메뉴·홈이 보이고, 반죽사용량 작성자는 로그인 사용자 이름”까지 한 번에 검증·롤백 단위로 두기 위함. 이후 단계에서 organization_id·RLS·다른 화면 작성자·admin 조회를 순서대로 넣으면 된다.

---

**다음 단계:** 위 “첫 구현 배치” 확정 후, S1～S1b～S2～S3 + A1～A3 + C1～C4 + V1～V3(및 V2b) 순으로 구현·검증 진행. 구현/커밋/배포는 본 문서 작성 범위 밖이다.
