-- 99. 기존 기록 지문 (조회 전용, 데이터 변경 없음)
-- 사전 점검, 093000 적용 후, 095000 적용 후에 각각 실행해 결과를 저장하고 비교합니다.
-- 1~25행(10/15 이전 작성 일지 머리글·항목)과 26행(10/15 13:30 이전 감사로그)은 세 번 모두 같아야 합니다.
-- 27행은 해시 체인 끊김 수(0이어야 함)와 최대 순번입니다. 최대 순번은 앱 사용 중 새 기록이 생기면 늘어나는 것이 정상입니다.
-- 사진 원문은 읽지 않습니다(입고검수 항목은 사진 저장 크기만 사용).
  SELECT 1 AS no, 'daily_hygiene_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_hygiene_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 2 AS no, 'daily_temp_humidity_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_temp_humidity_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 3 AS no, 'daily_sanitation_facility_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_sanitation_facility_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 4 AS no, 'daily_worker_hygiene_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_worker_hygiene_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 5 AS no, 'daily_cold_storage_hygiene_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_cold_storage_hygiene_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 6 AS no, 'daily_process_control_bread_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_process_control_bread_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 7 AS no, 'daily_material_storage_3f_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_material_storage_3f_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 8 AS no, 'daily_manufacturing_equipment_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_manufacturing_equipment_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 9 AS no, 'daily_air_conditioning_equipment_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_air_conditioning_equipment_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 10 AS no, 'daily_hoist_inspection_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_hoist_inspection_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 11 AS no, 'daily_illumination_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg((to_jsonb(x) - 'author_user_id')::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_illumination_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 12 AS no, 'daily_material_receiving_inspection_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_material_receiving_inspection_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 13 AS no, 'daily_raw_thawing_logs' AS table_name, count(*) AS row_count,
         md5(COALESCE(string_agg(to_jsonb(x)::text, '|' ORDER BY x.id), '')) AS fingerprint
    FROM public.daily_raw_thawing_logs x WHERE x.created_at < timestamptz '2026-10-15 00:00:00+09'
  UNION ALL
  SELECT 14, 'daily_hygiene_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_hygiene_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_hygiene_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 15, 'daily_temp_humidity_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_temp_humidity_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_temp_humidity_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 16, 'daily_sanitation_facility_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_sanitation_facility_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_sanitation_facility_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 17, 'daily_worker_hygiene_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_worker_hygiene_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_worker_hygiene_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 18, 'daily_cold_storage_hygiene_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_cold_storage_hygiene_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_cold_storage_hygiene_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 19, 'daily_process_control_bread_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_process_control_bread_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_process_control_bread_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 20, 'daily_material_storage_3f_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_material_storage_3f_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_material_storage_3f_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 21, 'daily_manufacturing_equipment_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_manufacturing_equipment_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_manufacturing_equipment_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 22, 'daily_air_conditioning_equipment_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_air_conditioning_equipment_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_air_conditioning_equipment_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 23, 'daily_hoist_inspection_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_hoist_inspection_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_hoist_inspection_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 24, 'daily_illumination_log_items', count(*),
         md5(COALESCE(string_agg(to_jsonb(i)::text, '|' ORDER BY i.id), ''))
    FROM public.daily_illumination_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_illumination_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 25, 'daily_material_receiving_inspection_log_items', count(*),
         md5(COALESCE(string_agg(concat_ws('|', i.id, i.log_id, i.line_index, i.storage_category, i.item_name, i.box_qty, i.unit_qty, i.remainder_g, i.box_weight_g, i.unit_weight_g, i.total_weight_g, i.expiry_or_lot, i.conformity, i.remarks, i.created_at, pg_column_size(i.label_photo_url)), '|' ORDER BY i.id), ''))
    FROM public.daily_material_receiving_inspection_log_items i WHERE EXISTS (SELECT 1 FROM public.daily_material_receiving_inspection_logs x WHERE x.id = i.log_id AND x.created_at < timestamptz '2026-10-15 00:00:00+09')
  UNION ALL
  SELECT 26, 'audit_logs (10/15 13:30 이전)', count(*),
         md5(COALESCE(string_agg(concat_ws(':', a.id, a.action, a.target_table, a.target_id, a.chain_seq, a.row_hash, pg_column_size(a.before_data), pg_column_size(a.after_data)), ',' ORDER BY a.id), ''))
    FROM public.audit_logs a WHERE a.created_at < timestamptz '2026-10-15 13:30:00+09'
  UNION ALL
  SELECT 27, 'audit_logs 해시 체인 (끊김 수 / 최대 순번)',
         count(*) FILTER (WHERE NOT s.prev_ok OR s.gap <> 1),
         'max_chain_seq=' || COALESCE(max(s.chain_seq)::text, '없음')
    FROM (SELECT chain_seq,
                 prev_hash IS NOT DISTINCT FROM lag(row_hash) OVER (ORDER BY chain_seq) AS prev_ok,
                 COALESCE(chain_seq - lag(chain_seq) OVER (ORDER BY chain_seq), 1) AS gap
            FROM public.audit_logs WHERE chain_seq IS NOT NULL) s
  ORDER BY 1;
