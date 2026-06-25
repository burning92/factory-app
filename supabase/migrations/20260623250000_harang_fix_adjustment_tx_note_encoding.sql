-- 재고조정 확정 원장 비고 인코딩 깨짐 복구 (220000 마이그레이션 당시 '?ш퀬議곗젙 ?뺤젙' 등)
-- 수량·참조번호에는 영향 없음. 표시·되돌리기 가독성만 정리.

UPDATE public.harang_inventory_transactions t
SET note = '재고조정 확정'
WHERE t.tx_type = 'adjustment'
  AND t.reference_no LIKE 'SA-%'
  AND COALESCE(t.note, '') <> '재고조정 확정';

NOTIFY pgrst, 'reload schema';
