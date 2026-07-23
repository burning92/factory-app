import { supabase } from "@/lib/supabase";
import {
  overridesFromDbRows,
  type ClassificationOverrides,
} from "@/features/production/planning/productClassification";

export type PlanningClassificationRow = {
  base_name: string;
  major: string;
  pizza_subtype: string | null;
  note: string | null;
  updated_at: string;
};

export async function fetchPlanningClassificationOverrides(): Promise<{
  overrides: ClassificationOverrides;
  rows: PlanningClassificationRow[];
  error: string | null;
}> {
  const { data, error } = await supabase
    .from("planning_product_classifications")
    .select("base_name, major, pizza_subtype, note, updated_at")
    .order("base_name");
  if (error) {
    return { overrides: {}, rows: [], error: error.message };
  }
  const rows = (data as PlanningClassificationRow[]) ?? [];
  return {
    overrides: overridesFromDbRows(rows),
    rows,
    error: null,
  };
}
