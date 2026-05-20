-- Lab: production outbound auto-sync movement type
ALTER TABLE public.material_stock_movements
  DROP CONSTRAINT IF EXISTS material_stock_movements_type_check;

ALTER TABLE public.material_stock_movements
  ADD CONSTRAINT material_stock_movements_type_check CHECK (
    movement_type IN (
      'receipt',
      'production_reserved',
      'production_usage',
      'production_outbound',
      'return_unused',
      'waste',
      'adjustment',
      'ecount_reconcile'
    )
  );

COMMENT ON COLUMN public.material_stock_movements.movement_type IS 'production_outbound: 생산 출고(production_logs) Lab 연동 차감';
