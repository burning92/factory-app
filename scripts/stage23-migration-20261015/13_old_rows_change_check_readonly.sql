-- 13. 적용 시작 이후 10/15 이전 일지에 수정·삭제가 있었는지 감사로그로 확인 (조회 전용)
-- 첫 줄의 '적용 시작 시각'을 실제 시작 시각으로 바꿔 실행하세요. 기존 일지 원본이 바뀌면 090000 감사 트리거가 반드시 기록합니다.
-- 기대값: 기존_일지_수정_삭제 = 0, 기존_항목_수정_삭제 = 0
WITH p AS (SELECT timestamptz '2026-10-15 15:00:00+09' AS since, timestamptz '2026-10-15 00:00:00+09' AS cutoff)
SELECT count(*) FILTER (WHERE a.action IN ('update', 'delete')
                          AND COALESCE(a.before_data->>'created_at', a.after_data->>'created_at')::timestamptz < p.cutoff
                          AND a.target_table = ANY (ARRAY['daily_hygiene_logs', 'daily_temp_humidity_logs', 'daily_sanitation_facility_logs', 'daily_worker_hygiene_logs', 'daily_cold_storage_hygiene_logs', 'daily_process_control_bread_logs', 'daily_material_storage_3f_logs', 'daily_manufacturing_equipment_logs', 'daily_air_conditioning_equipment_logs', 'daily_hoist_inspection_logs', 'daily_illumination_logs', 'daily_material_receiving_inspection_logs', 'daily_raw_thawing_logs']::text[])) AS 기존_일지_수정_삭제,
       count(*) FILTER (WHERE a.action IN ('update', 'delete')
                          AND COALESCE(a.before_data->>'created_at', a.after_data->>'created_at')::timestamptz < p.cutoff
                          AND a.target_table = ANY (ARRAY['daily_hygiene_log_items', 'daily_temp_humidity_log_items', 'daily_sanitation_facility_log_items', 'daily_worker_hygiene_log_items', 'daily_cold_storage_hygiene_log_items', 'daily_process_control_bread_log_items', 'daily_material_storage_3f_log_items', 'daily_manufacturing_equipment_log_items', 'daily_air_conditioning_equipment_log_items', 'daily_hoist_inspection_log_items', 'daily_illumination_log_items', 'daily_material_receiving_inspection_log_items']::text[])) AS 기존_항목_수정_삭제,
       count(*) FILTER (WHERE a.action = 'create') AS 새_기록,
       count(*) AS 적용_이후_감사로그_전체,
       COALESCE(string_agg(DISTINCT a.actor_source, ', '), '없음') AS 기록_주체
FROM public.audit_logs a, p
WHERE a.created_at >= p.since
  AND a.target_table = ANY (ARRAY['daily_hygiene_logs', 'daily_temp_humidity_logs', 'daily_sanitation_facility_logs', 'daily_worker_hygiene_logs', 'daily_cold_storage_hygiene_logs', 'daily_process_control_bread_logs', 'daily_material_storage_3f_logs', 'daily_manufacturing_equipment_logs', 'daily_air_conditioning_equipment_logs', 'daily_hoist_inspection_logs', 'daily_illumination_logs', 'daily_material_receiving_inspection_logs', 'daily_raw_thawing_logs', 'daily_hygiene_log_items', 'daily_temp_humidity_log_items', 'daily_sanitation_facility_log_items', 'daily_worker_hygiene_log_items', 'daily_cold_storage_hygiene_log_items', 'daily_process_control_bread_log_items', 'daily_material_storage_3f_log_items', 'daily_manufacturing_equipment_log_items', 'daily_air_conditioning_equipment_log_items', 'daily_hoist_inspection_log_items', 'daily_illumination_log_items', 'daily_material_receiving_inspection_log_items']::text[]);
