-- 구분명 변경 호환: 기존 저장분을 새 체크리스트 제목으로 정리 (선택적 데이터 마이그레이션)
UPDATE public.daily_worker_hygiene_log_items
SET category = '현장 작업자 위생'
WHERE category = '작업자 개인위생';
