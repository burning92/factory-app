-- 결과 이력(equipment_history_updates) 삭제: manager·admin 허용
-- 본문(equipment_history_records) 삭제는 admin 전용 유지 (기존 마이그레이션과 동일)

DROP POLICY IF EXISTS "equipment_history_updates_delete" ON public.equipment_history_updates;

CREATE POLICY "equipment_history_updates_delete"
  ON public.equipment_history_updates FOR DELETE TO authenticated
  USING (public.get_my_profile_role() IN ('manager', 'admin'));

NOTIFY pgrst, 'reload schema';
