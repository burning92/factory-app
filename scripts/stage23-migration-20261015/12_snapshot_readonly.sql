-- 12. 가벼운 현황 스냅샷 (조회 전용, 해시 계산 없음)
-- 사전 점검과 각 단계 적용 후에 실행해 저장합니다.
-- old_rows·old_approved·old_max_updated_at(10/15 이전 작성분)은 매번 같아야 합니다.
-- all_rows, 감사로그 최대 순번은 현장 사용으로 늘어나는 것이 정상입니다. 감사로그 행의 old_max_updated_at 칸은 체인 끊김 수이며 0 이어야 합니다.
  SELECT 'daily_hygiene_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_hygiene_logs x
  UNION ALL
  SELECT 'daily_temp_humidity_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_temp_humidity_logs x
  UNION ALL
  SELECT 'daily_sanitation_facility_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_sanitation_facility_logs x
  UNION ALL
  SELECT 'daily_worker_hygiene_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_worker_hygiene_logs x
  UNION ALL
  SELECT 'daily_cold_storage_hygiene_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_cold_storage_hygiene_logs x
  UNION ALL
  SELECT 'daily_process_control_bread_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_process_control_bread_logs x
  UNION ALL
  SELECT 'daily_material_storage_3f_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_material_storage_3f_logs x
  UNION ALL
  SELECT 'daily_manufacturing_equipment_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_manufacturing_equipment_logs x
  UNION ALL
  SELECT 'daily_air_conditioning_equipment_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_air_conditioning_equipment_logs x
  UNION ALL
  SELECT 'daily_hoist_inspection_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_hoist_inspection_logs x
  UNION ALL
  SELECT 'daily_illumination_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_illumination_logs x
  UNION ALL
  SELECT 'daily_material_receiving_inspection_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_material_receiving_inspection_logs x
  UNION ALL
  SELECT 'daily_raw_thawing_logs' AS table_name,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09') AS old_rows,
         count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09' AND x.status = 'approved') AS old_approved,
         max(x.updated_at) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09')::text AS old_max_updated_at,
         count(*) AS all_rows
    FROM public.daily_raw_thawing_logs x
  UNION ALL
  SELECT 'daily_hygiene_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_hygiene_log_items i LEFT JOIN public.daily_hygiene_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_temp_humidity_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_temp_humidity_log_items i LEFT JOIN public.daily_temp_humidity_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_sanitation_facility_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_sanitation_facility_log_items i LEFT JOIN public.daily_sanitation_facility_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_worker_hygiene_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_worker_hygiene_log_items i LEFT JOIN public.daily_worker_hygiene_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_cold_storage_hygiene_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_cold_storage_hygiene_log_items i LEFT JOIN public.daily_cold_storage_hygiene_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_process_control_bread_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_process_control_bread_log_items i LEFT JOIN public.daily_process_control_bread_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_material_storage_3f_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_material_storage_3f_log_items i LEFT JOIN public.daily_material_storage_3f_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_manufacturing_equipment_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_manufacturing_equipment_log_items i LEFT JOIN public.daily_manufacturing_equipment_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_air_conditioning_equipment_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_air_conditioning_equipment_log_items i LEFT JOIN public.daily_air_conditioning_equipment_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_hoist_inspection_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_hoist_inspection_log_items i LEFT JOIN public.daily_hoist_inspection_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_illumination_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_illumination_log_items i LEFT JOIN public.daily_illumination_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'daily_material_receiving_inspection_log_items', count(*) FILTER (WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'), NULL::bigint, NULL::text, count(*)
    FROM public.daily_material_receiving_inspection_log_items i LEFT JOIN public.daily_material_receiving_inspection_logs x ON x.id = i.log_id
  UNION ALL
  SELECT 'audit_logs (10/15 이전 / 최대 순번 / 체인 끊김)', count(*) FILTER (WHERE created_at < timestamptz '2026-10-15 00:00:00+09'),
         max(chain_seq), (SELECT count(*)::text FROM (SELECT prev_hash IS NOT DISTINCT FROM lag(row_hash) OVER (ORDER BY chain_seq) AS ok FROM public.audit_logs WHERE chain_seq IS NOT NULL) s WHERE NOT s.ok), count(*)
    FROM public.audit_logs
  ORDER BY 1;
