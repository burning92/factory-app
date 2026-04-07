-- 설비 이상: INSERT는 manager/admin만. UPDATE/DELETE는 클라이언트에서 차단(서비스 롤은 RLS 우회).
DROP POLICY IF EXISTS "equipment_incidents_insert" ON public.equipment_incidents;
CREATE POLICY "equipment_incidents_insert" ON public.equipment_incidents FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('manager', 'admin')
  )
);

DROP POLICY IF EXISTS "equipment_incidents_update" ON public.equipment_incidents;
CREATE POLICY "equipment_incidents_update" ON public.equipment_incidents FOR UPDATE USING (false);

DROP POLICY IF EXISTS "equipment_incidents_delete" ON public.equipment_incidents;
CREATE POLICY "equipment_incidents_delete" ON public.equipment_incidents FOR DELETE USING (false);

NOTIFY pgrst, 'reload schema';
