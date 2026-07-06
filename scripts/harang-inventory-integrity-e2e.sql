-- =============================================================================
-- 하랑 재고 정합성 구조 변경 1차 — 관리자 E2E 검증 SQL
-- 용도: Supabase SQL Editor 또는 psql에서 읽기 전용 확인 + 테스트 전후 비교
-- 주의: G03 청양페퍼로니 LOT/생산은 테스트 대상에서 제외하세요.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) 연결 프로젝트 확인 (수동)
-- .env.local / factory.armoredfresh.com 빌드 산출물 모두
--   https://wvqceauupzolhpltrmde.supabase.co 를 가리키면 운영 DB입니다.
-- -----------------------------------------------------------------------------

-- 마이그레이션 반영 여부 (읽기 전용)
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'harang_production_line_lots'
  AND column_name = 'inventory_transaction_id';

SELECT proname
FROM pg_proc
WHERE proname IN (
  'harang_lot_ledger_sum',
  'harang_assert_production_inventory_integrity',
  'harang_reject_legacy_unlinked_production',
  'harang_list_lot_current_vs_ledger_mismatches'
)
ORDER BY 1;


-- =============================================================================
-- 1) 테스트 변수 설정 — E2E 시작 전 아래 3개를 실제 값으로 바꾸세요
-- =============================================================================
-- 권장 후보 (G03 미사용 부자재, 운영 영향 최소):
--   lot_id     = '8fe439fa-4dfa-463a-b534-e75c54ce062f'  -- 우주인피자 배송박스
--   item_id    = 'c477a36c-cc3f-4023-9fe0-ebc0eba26802'
-- 레거시 차단 확인용 (조회·RPC 실패만, 데이터 변경 금지):
--   legacy_header_id = 'f0a14946-0b0f-4675-aade-0b63e85460a9'  -- 2026/05/21-1 허니갈릭

-- psql 변수 예시:
-- \set test_lot_id '8fe439fa-4dfa-463a-b534-e75c54ce062f'
-- \set test_header_id '00000000-0000-0000-0000-000000000000'  -- E2E-1 저장 후 채움
-- \set legacy_header_id 'f0a14946-0b0f-4675-aade-0b63e85460a9'

-- SQL Editor에서는 literal로 치환:
--   :test_lot_id → '8fe439fa-4dfa-463a-b534-e75c54ce062f'


-- =============================================================================
-- 2) 테스트 전 LOT 원장 상태 캡처 (§3)
-- =============================================================================
WITH lot_base AS (
  SELECT
    l.id AS lot_id,
    l.item_id,
    l.item_name,
    l.item_code,
    l.lot_date,
    l.inbound_date,
    l.initial_quantity,
    l.current_quantity,
    l.unit,
    l.category
  FROM public.harang_inventory_lots l
  WHERE l.id = '8fe439fa-4dfa-463a-b534-e75c54ce062f'  -- ← test_lot_id
),
tx_agg AS (
  SELECT
    t.lot_id,
    COALESCE(SUM(t.quantity_delta), 0)::NUMERIC(14, 3) AS ledger_sum,
    COALESCE(SUM(CASE WHEN t.tx_type = 'usage' THEN ABS(t.quantity_delta) ELSE 0 END), 0)::NUMERIC(14, 3) AS usage_sum,
    COUNT(*)::INT AS transaction_count
  FROM public.harang_inventory_transactions t
  WHERE t.lot_id = '8fe439fa-4dfa-463a-b534-e75c54ce062f'  -- ← test_lot_id
  GROUP BY t.lot_id
)
SELECT
  b.lot_id,
  b.item_name,
  b.item_code,
  b.lot_date,
  b.inbound_date,
  b.initial_quantity,
  b.current_quantity,
  COALESCE(a.ledger_sum, 0) AS ledger_sum,
  public.harang_lot_ledger_sum(b.lot_id) AS ledger_sum_rpc,
  COALESCE(a.usage_sum, 0) AS usage_sum,
  COALESCE(a.transaction_count, 0) AS transaction_count,
  b.current_quantity - COALESCE(a.ledger_sum, 0) AS cache_vs_ledger_diff,
  now() AT TIME ZONE 'Asia/Seoul' AS captured_at_kst
FROM lot_base b
LEFT JOIN tx_agg a ON a.lot_id = b.lot_id;

-- 여러 LOT 동시 캡처 (테스트에 쓰는 모든 LOT)
SELECT
  l.id AS lot_id,
  l.item_name,
  l.lot_date,
  l.current_quantity,
  public.harang_lot_ledger_sum(l.id) AS ledger_sum,
  (SELECT COUNT(*) FROM public.harang_inventory_transactions t WHERE t.lot_id = l.id) AS transaction_count
FROM public.harang_inventory_lots l
WHERE l.id IN (
  '8fe439fa-4dfa-463a-b534-e75c54ce062f'  -- 테스트 LOT 목록
)
ORDER BY l.lot_date;


-- =============================================================================
-- 3) E2E-1 신규 직접 생산 저장 — 테스트 후 확인 SQL
--    (브라우저: 로그인 후 DevTools → create_harang_production_with_usage 호출)
-- =============================================================================
-- header_id를 알고 있을 때:
-- \set test_header_id '<E2E-1에서_반환된_UUID>'

SELECT
  h.id AS header_id,
  h.production_no,
  h.production_date,
  h.product_name,
  h.finished_qty,
  h.note,
  h.request_line_id IS NULL AS is_direct_production
FROM public.harang_production_headers h
WHERE h.id = '00000000-0000-0000-0000-000000000000';  -- ← test_header_id

SELECT
  pl.id AS line_id,
  pl.material_name,
  pl.usage_qty,
  pll.id AS line_lot_id,
  pll.lot_id,
  pll.quantity_used,
  pll.inventory_transaction_id,
  tx.id AS tx_id,
  tx.tx_type,
  tx.quantity_delta,
  tx.reference_no,
  tx.note,
  ABS(tx.quantity_delta) = pll.quantity_used AS qty_matches,
  tx.reference_no = h.production_no AS ref_matches_production_no,
  tx.note = '생산입고' AS note_matches
FROM public.harang_production_headers h
JOIN public.harang_production_lines pl ON pl.header_id = h.id
LEFT JOIN public.harang_production_line_lots pll ON pll.line_id = pl.id
LEFT JOIN public.harang_inventory_transactions tx ON tx.id = pll.inventory_transaction_id
WHERE h.id = '00000000-0000-0000-0000-000000000000'  -- ← test_header_id
ORDER BY pl.sort_order, pll.created_at;

-- FK NOT NULL + orphan 없음
SELECT
  COUNT(*) FILTER (WHERE pll.quantity_used > 0.0005 AND pll.inventory_transaction_id IS NULL) AS unlinked_line_lots,
  COUNT(*) FILTER (WHERE pll.inventory_transaction_id IS NOT NULL) AS linked_line_lots
FROM public.harang_production_line_lots pll
JOIN public.harang_production_lines pl ON pl.id = pll.line_id
WHERE pl.header_id = '00000000-0000-0000-0000-000000000000';  -- ← test_header_id

-- assert RPC (성공 시 빈 결과 / 예외 없음)
SELECT public.harang_assert_production_inventory_integrity('00000000-0000-0000-0000-000000000000');

-- LOT current = ledger
SELECT
  l.id AS lot_id,
  l.current_quantity,
  public.harang_lot_ledger_sum(l.id) AS ledger_sum,
  ABS(l.current_quantity - public.harang_lot_ledger_sum(l.id)) <= 0.0005 AS matches
FROM public.harang_inventory_lots l
WHERE l.id IN (
  SELECT DISTINCT pll.lot_id
  FROM public.harang_production_line_lots pll
  JOIN public.harang_production_lines pl ON pl.id = pll.line_id
  WHERE pl.header_id = '00000000-0000-0000-0000-000000000000'
);


-- =============================================================================
-- 4) E2E-2 신규 작업지시 생산 저장 — 테스트 후 확인 SQL
--    (브라우저: /harang/production-input/new?request_line_id=...)
-- =============================================================================
-- 작업지시 생산은 note = '작업지시 생산입고', reference_no = request_no

SELECT
  h.id,
  h.production_no,
  rq.request_no,
  tx.reference_no,
  tx.note,
  tx.reference_no = rq.request_no AS ref_is_request_no,
  tx.note = '작업지시 생산입고' AS note_ok
FROM public.harang_production_headers h
LEFT JOIN public.harang_production_requests rq ON rq.id = h.request_id
JOIN public.harang_production_lines pl ON pl.header_id = h.id
JOIN public.harang_production_line_lots pll ON pll.line_id = pl.id
JOIN public.harang_inventory_transactions tx ON tx.id = pll.inventory_transaction_id
WHERE h.id = '00000000-0000-0000-0000-000000000000';  -- ← test_header_id


-- =============================================================================
-- 5) E2E-2/3 신규 생산 수정 — 테스트 후 확인 SQL
-- =============================================================================
-- 수정 전 usage tx id 목록을 저장해 두었다가, 수정 후 사라졌는지 확인

-- 수정 전 스냅샷 (수정 직전 1회 실행)
SELECT
  pll.inventory_transaction_id AS tx_id_before,
  pll.quantity_used,
  pll.lot_id
FROM public.harang_production_line_lots pll
JOIN public.harang_production_lines pl ON pl.id = pll.line_id
WHERE pl.header_id = '00000000-0000-0000-0000-000000000000'
  AND pll.inventory_transaction_id IS NOT NULL;

-- 수정 후: 이전 tx_id가 원장에 남아 있으면 orphan
SELECT tx.id, tx.lot_id, tx.quantity_delta, tx.reference_no, tx.note
FROM public.harang_inventory_transactions tx
WHERE tx.id IN (
  123456789  -- ← 수정 전에 저장한 tx_id 목록
);

-- 수정 후 신규 연결 확인 (E2E-1 블록과 동일)
SELECT public.harang_assert_production_inventory_integrity('00000000-0000-0000-0000-000000000000');


-- =============================================================================
-- 6) E2E-3 신규 생산 삭제 — 테스트 후 확인 SQL
-- =============================================================================
-- header 존재 여부
SELECT COUNT(*) AS header_exists
FROM public.harang_production_headers
WHERE id = '00000000-0000-0000-0000-000000000000';

-- line_lots / lines 잔존
SELECT
  (SELECT COUNT(*) FROM public.harang_production_lines WHERE header_id = '00000000-0000-0000-0000-000000000000') AS lines_left,
  (SELECT COUNT(*)
   FROM public.harang_production_line_lots pll
   JOIN public.harang_production_lines pl ON pl.id = pll.line_id
   WHERE pl.header_id = '00000000-0000-0000-0000-000000000000') AS line_lots_left;

-- 삭제 전에 기록한 usage tx id가 원장에 남아 있으면 orphan
SELECT COUNT(*) AS orphan_usage_tx
FROM public.harang_inventory_transactions
WHERE id IN (123456789);  -- ← 삭제 전 tx_id 목록

-- 테스트 LOT가 테스트 전 상태로 복귀했는지 (§2 캡처와 비교)
SELECT
  l.current_quantity,
  public.harang_lot_ledger_sum(l.id) AS ledger_sum
FROM public.harang_inventory_lots l
WHERE l.id = '8fe439fa-4dfa-463a-b534-e75c54ce062f';


-- =============================================================================
-- 7) E2E-4 재고 부족 rollback — 실패 직후 확인 SQL
-- =============================================================================
-- 실패 시도 직전 production_no 시퀀스 / 오늘 날짜 header 개수 기록 후 비교

SELECT COUNT(*) AS headers_today
FROM public.harang_production_headers
WHERE production_date = CURRENT_DATE;

-- 실패한 production_no가 생겼는지 (시도한 날짜로 교체)
SELECT id, production_no, created_at
FROM public.harang_production_headers
WHERE production_date = '2026-07-01'  -- ← 시도한 생산일
ORDER BY created_at DESC
LIMIT 5;

-- LOT 수량 변화 없음 (§2 캡처와 동일해야 함)
SELECT
  l.current_quantity,
  public.harang_lot_ledger_sum(l.id) AS ledger_sum,
  (SELECT COUNT(*) FROM public.harang_inventory_transactions t WHERE t.lot_id = l.id) AS transaction_count
FROM public.harang_inventory_lots l
WHERE l.id = '8fe439fa-4dfa-463a-b534-e75c54ce062f';

-- 기대 에러 메시지 패턴 (RPC):
--   재고가 부족합니다 (원장 기준 %g): %


-- =============================================================================
-- 8) E2E-5 레거시 생산 수정/삭제 차단 — 변경 없음 확인 SQL
-- =============================================================================
-- 테스트 전 스냅샷
SELECT
  h.id,
  h.production_no,
  h.product_name,
  h.updated_at,
  (SELECT COUNT(*) FROM public.harang_production_lines pl WHERE pl.header_id = h.id) AS line_count,
  (SELECT COUNT(*) FROM public.harang_production_line_lots pll
   JOIN public.harang_production_lines pl ON pl.id = pll.line_id
   WHERE pl.header_id = h.id) AS line_lot_count,
  (SELECT COUNT(*) FROM public.harang_production_line_lots pll
   JOIN public.harang_production_lines pl ON pl.id = pll.line_id
   WHERE pl.header_id = h.id AND pll.inventory_transaction_id IS NULL AND pll.quantity_used > 0.0005) AS legacy_unlinked_count
FROM public.harang_production_headers h
WHERE h.id = 'f0a14946-0b0f-4675-aade-0b63e85460a9';  -- ← legacy_header_id

-- line_lots 상세 (해시 비교용)
SELECT
  pll.id,
  pll.line_id,
  pll.lot_id,
  pll.quantity_used,
  pll.inventory_transaction_id,
  pll.updated_at
FROM public.harang_production_line_lots pll
JOIN public.harang_production_lines pl ON pl.id = pll.line_id
WHERE pl.header_id = 'f0a14946-0b0f-4675-aade-0b63e85460a9'
ORDER BY pll.id;

-- 연결 usage 원장 건수 (레거시는 pool/NULL 혼재 가능 — 개수·합계가 변하지 않아야 함)
SELECT
  COUNT(*) AS usage_tx_count,
  COALESCE(SUM(t.quantity_delta), 0) AS usage_delta_sum
FROM public.harang_inventory_transactions t
WHERE t.id IN (
  SELECT pll.inventory_transaction_id
  FROM public.harang_production_line_lots pll
  JOIN public.harang_production_lines pl ON pl.id = pll.line_id
  WHERE pl.header_id = 'f0a14946-0b0f-4675-aade-0b63e85460a9'
    AND pll.inventory_transaction_id IS NOT NULL
);

-- RPC 차단 확인 (예외 발생이 정상 — SQL Editor에서는 아래가 에러로 끝나야 함)
SELECT public.harang_reject_legacy_unlinked_production('f0a14946-0b0f-4675-aade-0b63e85460a9');

-- 테스트 후: 위 스냅샷과 updated_at / count / quantity_used 가 동일한지 비교


-- =============================================================================
-- 9) 레거시 후보 자동 조회 (G03 phantom 포함 여부 확인, 읽기 전용)
-- =============================================================================
SELECT
  h.id AS header_id,
  h.production_no,
  h.product_name,
  h.production_date,
  COUNT(*) FILTER (WHERE pll.inventory_transaction_id IS NULL AND pll.quantity_used > 0.0005) AS legacy_unlinked_lots
FROM public.harang_production_headers h
JOIN public.harang_production_lines pl ON pl.header_id = h.id
JOIN public.harang_production_line_lots pll ON pll.line_id = pl.id
GROUP BY h.id, h.production_no, h.product_name, h.production_date
HAVING COUNT(*) FILTER (WHERE pll.inventory_transaction_id IS NULL AND pll.quantity_used > 0.0005) > 0
ORDER BY h.production_date DESC
LIMIT 20;
