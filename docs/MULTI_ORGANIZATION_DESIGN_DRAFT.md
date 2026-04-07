# 멀티 사업장(회사코드 + 개인 계정 + 권한 분리) 설계 초안

아머드프레시뿐 아니라 OEM 업체(예: 하랑)도 함께 사용할 수 있도록, **회사코드 + 개인 계정 + 권한 분리** 구조 기준의 설계 초안이다. 구현이 아닌 설계 방향만 정리한다.

---

## 1. 목표

| 목표 | 설명 |
|------|------|
| 회사별 데이터 분리 | 조직(organization) 단위로 생산/사용량/출고·재고 등이 격리됨 |
| 작업자별 로그인 유지 | 개인 계정으로 로그인하고, 세션은 기기별로 유지 |
| 작성자 자동입력 | 저장 시 작성자명은 **로그인한 사용자 이름** 기준 자동 주입(수기 입력 fallback 가능) |
| 관리자 통합 조회 | 관리자 계정은 여러 회사/사업장 데이터를 통합 조회·비교 가능 |

---

## 2. 회사(organization) 테이블 구조

**테이블명:** `organizations` (또는 `sites`)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid | PK |
| `organization_code` | text, UNIQUE | 회사 구분 코드 (예: `armored`, `harang`). 로그인/API에서 scope 식별용 |
| `name` | text | 표시명 (예: "아머드프레시", "하랑") |
| `is_active` | boolean | 사용 여부 (비활성 시 로그인 불가 등) |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

- 로그인 시 **어느 회사 소속인지**는 사용자(profile)의 `organization_id`로 결정.
- 필요 시 `site_id`를 별도 도입해 “한 회사 내 여러 공장”까지 나눌 수 있음(2단계: organization → site). 초안에서는 **1단계(회사)** 만 가정.

### 2.1 organization_code와 organization_id 역할 구분

| 구분 | 용도 | 사용처 |
|------|------|--------|
| **organization_code** | 사람이 구분하기 쉬운 식별자. **로그인 화면·소속 확인용**. | 로그인 UI에서 “어느 회사 계정으로 들어가는지” 표시/선택, URL·파라미터로 회사 구분 전달, 운영/관리 시 코드로 회사 지정 |
| **organization_id** | DB 내부 식별자(uuid). **데이터 테이블 join/filter의 유일한 기준**. | 모든 비즈니스 테이블 FK, RLS 조건, API 필터. 코드가 아닌 ID만 사용해 일관성·인덱스 효율 유지 |

- **정리:** 로그인 시 소속 확인·UI 표시에는 `organization_code`(또는 code로 조회한 organization 행)를 쓰고, **실제 쿼리·RLS·join은 항상 `organization_id`만 사용**한다. 코드는 사람용, ID는 데이터용으로 분리.

---

## 3. 사용자(profile) 테이블 구조

**테이블명:** `profiles` (또는 `user_profiles`)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid, PK | `auth.users.id`와 1:1 (FK) |
| `organization_id` | uuid, FK → organizations | 소속 회사. 데이터 scope·RLS의 기본 단위 |
| `display_name` | text | 화면 표시명, 작성자 자동입력용 |
| `role` | text | 권한 (예: `worker`, `manager`, `admin`) — 아래 권한 설계 참고 |
| `is_active` | boolean | 계정 사용 여부 |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

- **개인 계정:** `auth.users` 1건 = `profiles` 1건. 이메일/비밀번호는 개인별.
- **회사 구분:** `organization_id`로 “어느 회사 데이터만 볼 수 있는지” 결정.

### 3.1 admin의 멀티 조직 소속 표현 방식

- **문제:** `profiles.organization_id` 하나만 있으면, admin이 “여러 회사 데이터에 접근 가능”한 것을 **역할 예외**로만 처리해야 해서, “어느 회사 소속 admin인지”와 “어느 회사들을 볼 수 있는지”가 애매해질 수 있음.
- **v1 권장:** **단일 소속 + admin 예외**로 단순화.
  - 모든 사용자(admin 포함)는 `profiles.organization_id` 1개만 가짐.
  - **worker/manager:** 해당 `organization_id` 내 데이터만 접근.
  - **admin:** RLS에서 `role = 'admin'`이면 `organization_id` 조건을 넣지 않아 **전체 조직 조회** 허용. “소속”은 1개지만 “접근 권한”만 다중 조직으로 확장.
  - 장점: 스키마 변경 없이 구현 가능. 단점: admin이 “공식 소속”은 한 회사로만 표현됨.
- **향후 확장:** 한 사람이 여러 회사에 소속·권한을 가지려면 **설계안에 `user_organizations` 테이블을 미리 넣어 두는 것**을 권장.
  - 예: `user_organizations (user_id, organization_id, role, is_default)` — `profiles.organization_id`는 “기본 소속” 또는 deprecated 후 이 테이블만 사용.
  - admin은 이 테이블에 여러 행(armored, harang 등)을 두고, “현재 선택한 organization”을 세션에 보관해 조회 scope 결정.
  - v1에서는 도입하지 않고, **설계 문서에 “확장 시 이 테이블 사용”**만 명시해 두면, 이후 마이그레이션 시 혼선을 줄일 수 있음.

---

## 4. 각 생산/사용량/출고 데이터에 붙일 회사 식별값

**공통:** 핵심 비즈니스 테이블에는 **`organization_id`** (uuid, FK → organizations) 추가.

| 데이터 영역 | 테이블(예시) | 비고 |
|-------------|--------------|------|
| 생산 | `production_logs` | 회사별 생산 이력 |
| 반죽/사용량 | `dough_logs`, `dough_boms` | 회사별 반죽·배합 |
| 사용량 계산 | `usage_calculations` | 회사별 1차 마감 등 |
| 출고·재고 | `last_used_dates` | 원자재별 사용일 등 회사 단위 |
| 기준 정보 | `materials`, `bom` | 회사별 자재·BOM (공용 마스터가 있으면 별도 설계) |
| 앱 설정/최근값 | `app_recent_values` | 아래 4.1 참고 — scope에 따라 `organization_id`·`user_id` 반영 |
| 이력/상태 | `production_history_date_state` | 회사별 조회 |

- **Ecount 연동** 등 외부 연동이 회사별로 다르면 `ecount_sync_status`, `ecount_inventory_current` 등에도 `organization_id` 추가 검토.
- **저장/조회 시:** 로그인 사용자의 `organization_id`를 기준으로 `WHERE organization_id = :current_org` 적용(RLS 또는 애플리케이션 레벨).
- **하랑과 아머드프레시가 섞이지 않도록:** 모든 핵심 테이블에 `organization_id`를 두고, **조회·쓰기 시 반드시 현재 사용자 scope의 `organization_id`로 필터/삽입**하면, 물리적으로 같은 DB에 있어도 조직별 행이 분리된다. RLS로 “본인 조직 행만” 허용하면 코드 버그나 API 오류로 타 조직 데이터가 노출·변경되는 것을 방지할 수 있음.

### 4.1 app_recent_values 범위(scope) 명시

- **역할:** 최근 작성자명·화면별 최근값 등 “키–값” 저장. 멀티 조직 도입 시 **조직 공용 vs 사용자별**을 나눠야 함.
- **제안:**
  - **조직 공용:** 조직 내 누가 써도 같은 값을 쓰는 항목(예: 회사별 기본 설정).  
    → **`(organization_id, key)`** 로 유일. `user_id`는 NULL 또는 미사용.
  - **사용자별:** 사람마다 다르게 유지하는 항목(예: 최근 작성자명, 마지막 사용 필터).  
    → **`(organization_id, user_id, key)`** 로 유일. 같은 key라도 조직·사용자별로 다른 값 저장.
- **정리:**  
  - 스키마에 `organization_id`(NOT NULL), `user_id`(nullable, FK → auth.users) 추가.  
  - 조회/저장 시: 조직 공용은 `organization_id = :org AND user_id IS NULL AND key = :key`, 사용자별은 `organization_id = :org AND user_id = :uid AND key = :key`.  
  - 기존 단일 테넌트용 `key`만 쓰던 구조는 “사용자별”로 보아 `organization_id`(기본 조직 1개)+ `user_id`(현재 로그인 사용자)로 마이그레이션하면, 하랑/아머드프레시가 섞이지 않고 사용자별 최근값도 유지할 수 있음.

---

## 5. 권한(role) 설계

| 역할 | 설명 | 데이터 범위 |
|------|------|-------------|
| `worker` | 일반 작업자 | 소속 회사(`organization_id`) 내 데이터만 조회·등록·수정 |
| `manager` | 사업장/회사 관리자 | 동일 회사 내 데이터만. 필요 시 회사 내 사용자/설정 관리 |
| `admin` | 통합 관리자 | 여러 회사 데이터 **통합 조회** 가능(아머드프레시 + 하랑 등). 비교·대시보드·리포트용 |

- **구현 방식:**  
  - RLS에서 `role = 'admin'`이면 `organization_id` 조건 생략(전체 조회 허용).  
  - `worker`, `manager`는 `auth.uid()`에 해당하는 `profiles.organization_id`와 테이블의 `organization_id`가 일치할 때만 접근.

### 5.1 작성자 자동입력 정책

- **기본:** 저장 시 작성자명은 **로그인한 사용자 이름**(`profiles.display_name` 또는 `auth.users.raw_user_meta_data`)을 **자동 입력**한다. 사용자가 따로 쓰지 않으면 이 값이 그대로 저장됨.
- **수동 수정 허용 여부:**  
  - **허용하는 쪽:** 특정 화면(대리 입력, 공유 기기, 감독자 대신 입력 등)에서 다른 이름을 넣어야 할 수 있음.  
  - **허용 시 조건 제안:** “수정 가능하되, 기본값은 항상 로그인 사용자”로 두고, **변경한 경우에만** 입력란을 수정 가능하게 하거나, 변경 시 “다른 작성자로 저장” 같은 확인 문구를 두는 방식.  
  - **추적성(감사) 관점:** 감사로그를 위해 “저장된 작성자명”과 “실제 로그인 사용자 id”를 **둘 다** 저장하는 것이 좋음.  
    - 예: `작성자명`(text, 사용자에게 보이는 이름) + `작성자_user_id`(uuid, nullable, FK → auth.users).  
    - 수동으로 이름을 바꿔도 `작성자_user_id`는 “누가 저장 버튼을 눌렀는지”를 남기므로, “누가 대리 입력했는지” 추적 가능.  
- **정리:** 기본은 로그인 사용자 이름 자동입력, **수동 수정은 허용**하되(예외 상황 대비), **저장 시 “작성자명”과 “작성자_user_id”를 함께 두는 정책**이 추적성과 유연성을 모두 만족한다.

---

## 6. 로그인 후 기본 사업장 scope 적용 방식

1. **로그인:** Supabase Auth 이메일/비밀번호. 인증 성공 시 `auth.users.id` 확정.
2. **프로필 로드:** `profiles`에서 `id = auth.uid()`로 `organization_id`, `role`, `display_name` 조회.
3. **기본 scope:**  
   - **worker / manager:** 현재 사용자의 `organization_id`를 “현재 사업장”으로 고정. 모든 쿼리·RLS에 이 값 사용.  
   - **admin:** 기본값으로 “전체” 또는 “특정 회사 하나”를 선택하게 할 수 있음. 선택한 scope에 따라 `organization_id` 필터 적용 또는 미적용.
4. **클라이언트:** 세션/전역 상태에 `current_organization_id`, `current_role` 등을 두고, API/쿼리에서 일괄 사용.

---

## 7. 관리자만 아머드프레시/하랑 전체 추이 비교 가능하게 하는 방식

- **역할 제한:** `admin`만 다중 회사 데이터 접근 허용. RLS/API에서 `role <> 'admin'`이면 단일 `organization_id`만 허용.
- **비교 화면:**  
  - “통합 대시보드” 또는 “회사 비교” 메뉴는 `admin`일 때만 노출.  
  - 조회 시 `organization_id IN (armored_id, harang_id)` 또는 `organization_id IS NULL`(전체)로 조회.  
- **데이터 무결성:** 모든 쓰기(생산/사용량/출고 등)는 여전히 **단일 organization_id**만 갖도록 하고, 비교는 “읽기 전용 집계”로만 수행하면, 권한 오류·데이터 섞임을 방지하기 쉬움.

---

## 8. 추천 방향 요약

| 항목 | 방향 |
|------|------|
| 인증 | Supabase Auth (이메일/비밀번호, 개인 계정) |
| 회사 구분 | `organization_code` + `organizations.id`(organization_id) |
| 사용자 | `auth.users` 1인 1계정, `profiles`에 `organization_id`, `display_name`, `role` |
| 데이터 분리 | 모든 핵심 테이블에 `organization_id` 추가, RLS로 회사별 격리 |
| 작성자 | 로그인 사용자 이름 자동 주입 우선, 수기 입력은 fallback |

---

## 9. “회사코드 + 개인 ID/PW” vs “공용 ID/PW” 비교

| 구분 | 회사코드 + 개인 ID/PW | 공용 ID/PW |
|------|------------------------|------------|
| **계정 단위** | 1인 1계정 (이메일 등) | 사업장/회사당 1개 공용 계정 |
| **작성자 추적** | 저장 데이터에 “누가 했는지” 개인별로 명확 | 동일 계정으로 여러 명 사용 시 작성자 구분 불가 |
| **보안·감사** | 비밀번호 분실·변경·권한 회수가 개인 단위로 가능 | 한 계정 공유 시 유출·부정 사용 시 책임 소재 불명 |
| **권한 분리** | 역할(worker/manager/admin)을 **사람별**로 부여 가능 | 공용 계정은 역할을 “계정”에만 붙이므로 사람 단위 제어 어려움 |
| **멀티 사업장** | 한 사람을 여러 회사에 배치할 때 “현재 회사”만 바꾸면 됨 | 사업장마다 공용 계정을 두면 계정 수 폭증, 관리 부담 |
| **로그인 유지** | 기기별로 “그 사람” 세션 유지, 작성자 자동입력과 자연스럽게 연결 | 공용 계정은 기기만 바꿔도 동일 계정이라 “작성자=로그인 사용자” 의미 퇴색 |

**전자(회사코드 + 개인 ID/PW)가 더 적합한 이유 요약:**

- **감사·책임:** “누가, 언제, 어느 회사 데이터를 넣었는지”를 개인 단위로 남길 수 있음.
- **작성자 자동입력:** 로그인 사용자 = 작성자로 매핑할 수 있어, 요구사항(“작성자 자동입력은 로그인한 사용자 이름 기준”)을 만족하기 쉬움.
- **확장성:** 나중에 역할·소속을 세밀하게 나누거나, 한 사람이 여러 회사에 권한을 가지는 구조로 바꾸기 좋음.
- **보안:** 공용 비밀번호 공유를 없애고, 계정 정책(만료, 비밀번호 복잡도 등)을 사람 단위로 적용 가능.

---

## 10. 초안 정리 (체크리스트)

- [x] 회사(organization) 테이블 구조
- [x] 사용자(profile) 테이블 구조
- [x] 생산/사용량/출고 등에 붙일 회사 식별값(`organization_id`)
- [x] 권한(role) 설계
- [x] 로그인 후 기본 사업장 scope 적용 방식
- [x] 관리자만 다중 회사(아머드프레시/하랑) 통합·비교 조회 가능한 방식
- [x] “회사코드 + 개인 ID/PW” vs “공용 ID/PW” 비교 및 전자 채택 이유

---

## 11. 마이그레이션 순서 (요약)

1. **organizations** 테이블 생성 및 초기 데이터(예: armored, harang) 삽입.
2. **profiles** 테이블 생성. 기존 auth.users가 있으면 트리거/배치로 profile 행 생성, `organization_id`는 기본 조직 1개로 설정.
3. 비즈니스 테이블에 **organization_id** 컬럼 추가(NOT NULL이면 기본값 설정 후 ALTER), FK·인덱스 추가.
4. **app_recent_values**에 `organization_id`, `user_id`(nullable) 추가 후, 기존 행을 기본 조직·user_id NULL(또는 매핑)로 이전.
5. **RLS** 활성화 및 정책 적용(아래 12절 원칙).
6. API·클라이언트에서 로그인 사용자 `organization_id`/`role` 반영, 작성자 자동입력 연동.

---

## 12. 최소 RLS 적용 원칙

- **원칙:** “기본은 막고, 필요한 것만 열어 준다.”  
  - 모든 핵심 테이블에 RLS를 켜고, **기본 정책은 SELECT/INSERT/UPDATE/DELETE 모두 거부**로 두거나, “해당 organization_id + 역할 조건”을 만족할 때만 허용.
- **최소 적용 대상:**  
  - `organizations`: admin만 전체 조회, 그 외 본인 소속 1건만 조회 등.  
  - `profiles`: 본인 행만 조회/수정, admin은 조회만 확장 등.  
  - 생산/사용량/출고/마스터 테이블: **organization_id = (현재 사용자 scope)** 일 때만 접근, admin은 role로 조건 완화.
- **예외:**  
  - 서버 전용 서비스 역할(예: Ecount 동기화)은 RLS bypass 또는 별도 정책으로, **organization_id를 명시해** 특정 조직만 접근하도록 제한.

---

**다음 단계(구현 시):**  
- Supabase에 `organizations`, `profiles` 마이그레이션  
- 기존 테이블에 `organization_id` 추가 및 데이터 이전 전략  
- RLS 정책·API에 `organization_id`/`role` 반영  
- 로그인 플로우와 `getDefaultAuthorName()`에 `profiles.display_name` 연동
