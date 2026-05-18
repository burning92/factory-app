-- Admin-only material stock ledger lab (baseline + movements + read view).
-- RLS ON, no policies → deny for anon/authenticated; service_role bypasses RLS for API routes.

CREATE TABLE IF NOT EXISTS public.material_stock_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  inventory_item_code TEXT NOT NULL,
  baseline_qty_g NUMERIC NOT NULL DEFAULT 0,
  baseline_at TIMESTAMPTZ NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'ecount',
  source_sync_name TEXT,
  source_synced_at TIMESTAMPTZ,
  memo TEXT,
  captured_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.material_stock_baselines IS 'Admin Lab: baseline stock snapshots per normalized inventory_item_code; append history (no delete).';
COMMENT ON COLUMN public.material_stock_baselines.inventory_item_code IS 'Normalized item code (trim, upper, whitespace removed) — same rule as app normalizeInventoryItemCode.';
COMMENT ON COLUMN public.material_stock_baselines.captured_by IS 'User who captured the baseline (same as created_by for manual capture).';

CREATE INDEX IF NOT EXISTS idx_material_stock_baselines_code_time
  ON public.material_stock_baselines (inventory_item_code, baseline_at DESC, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.material_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_item_code TEXT NOT NULL,
  material_id UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL,
  qty_g NUMERIC NOT NULL,
  effective_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_table TEXT,
  source_id TEXT,
  source_version TEXT,
  idempotency_key TEXT,
  memo TEXT,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT material_stock_movements_type_check CHECK (
    movement_type IN (
      'receipt',
      'production_reserved',
      'production_usage',
      'return_unused',
      'waste',
      'adjustment',
      'ecount_reconcile'
    )
  )
);

COMMENT ON TABLE public.material_stock_movements IS 'Admin Lab: append-only movements; cancel via voided_at/voided_by only.';
COMMENT ON COLUMN public.material_stock_movements.inventory_item_code IS 'Normalized item code (same as baselines).';
COMMENT ON COLUMN public.material_stock_movements.qty_g IS 'Signed delta on on-hand stock except production_reserved (affects reserved_stock only).';

CREATE INDEX IF NOT EXISTS idx_material_stock_movements_code
  ON public.material_stock_movements (inventory_item_code);

CREATE INDEX IF NOT EXISTS idx_material_stock_movements_effective
  ON public.material_stock_movements (effective_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS material_stock_movements_idempotency_active_idx
  ON public.material_stock_movements (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND voided_at IS NULL;

CREATE OR REPLACE VIEW public.material_stock_current_v AS
WITH latest_baseline AS (
  SELECT DISTINCT ON (inventory_item_code)
    inventory_item_code,
    baseline_qty_g,
    baseline_at
  FROM public.material_stock_baselines
  ORDER BY
    inventory_item_code,
    baseline_at DESC,
    created_at DESC,
    id DESC
),
movement_agg AS (
  SELECT
    inventory_item_code,
    SUM(
      CASE
        WHEN voided_at IS NULL AND movement_type IS DISTINCT FROM 'production_reserved' THEN qty_g
        ELSE 0::numeric
      END
    ) AS on_hand_delta_g,
    SUM(
      CASE
        WHEN voided_at IS NULL AND movement_type = 'production_reserved' THEN qty_g
        ELSE 0::numeric
      END
    ) AS reserved_stock_g
  FROM public.material_stock_movements
  GROUP BY inventory_item_code
)
SELECT
  COALESCE(lb.inventory_item_code, ma.inventory_item_code) AS inventory_item_code,
  COALESCE(lb.baseline_qty_g, 0::numeric) AS baseline_qty_g,
  lb.baseline_at,
  COALESCE(ma.on_hand_delta_g, 0::numeric) AS movement_sum_g,
  COALESCE(ma.reserved_stock_g, 0::numeric) AS reserved_stock_g,
  COALESCE(lb.baseline_qty_g, 0::numeric) + COALESCE(ma.on_hand_delta_g, 0::numeric) AS current_stock_g,
  (COALESCE(lb.baseline_qty_g, 0::numeric) + COALESCE(ma.on_hand_delta_g, 0::numeric))
    - COALESCE(ma.reserved_stock_g, 0::numeric) AS available_stock_g
FROM latest_baseline lb
FULL OUTER JOIN movement_agg ma ON lb.inventory_item_code = ma.inventory_item_code;

COMMENT ON VIEW public.material_stock_current_v IS 'Admin Lab: one row per normalized inventory_item_code; latest baseline + non-void movements.';

ALTER TABLE public.material_stock_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_stock_movements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.material_stock_baselines FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.material_stock_movements FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.material_stock_current_v FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT ON public.material_stock_baselines TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.material_stock_movements TO service_role;
GRANT SELECT ON public.material_stock_current_v TO service_role;
