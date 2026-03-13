-- ============================================================
-- 공장 관리 시스템 Supabase 테이블 생성 스크립트
-- Supabase Dashboard > SQL Editor에서 전체 복사 후 Run 실행
-- ============================================================

-- 1. 원료 마스터 (materials)
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_name TEXT NOT NULL UNIQUE,
  box_weight_g INT NOT NULL DEFAULT 0,
  unit_weight_g INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.materials IS '원료 마스터: 원료명, 1박스 중량(g), 1개(낱개) 중량(g)';

-- 2. 제품 BOM / 레시피 마스터 (bom)
CREATE TABLE IF NOT EXISTS public.bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_name TEXT NOT NULL,
  material_name TEXT NOT NULL,
  bom_g_per_ea NUMERIC(10,2) NOT NULL CHECK (bom_g_per_ea >= 0),
  basis TEXT NOT NULL CHECK (basis IN ('완제품', '도우')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (product_name, material_name, basis)
);

COMMENT ON TABLE public.bom IS '제품별 BOM: 제품명, 원료명, 단위당 g, 기준(완제품/도우)';

-- 3. 출고·잔량 기록 (production_logs)
-- outbound_lines: 소비기한별 출고 [{ "소비기한": "2026-12-31", "박스": 1, "낱개": 2, "g": 500 }]
CREATE TABLE IF NOT EXISTS public.production_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_date DATE NOT NULL,
  product_name TEXT NOT NULL,
  material_name TEXT NOT NULL,
  outbound_lines JSONB DEFAULT '[]'::jsonb,
  outbound_box INT NOT NULL DEFAULT 0,
  outbound_bag INT NOT NULL DEFAULT 0,
  outbound_g INT NOT NULL DEFAULT 0,
  dough_qty INT,
  finished_qty_expected INT,
  actual_usage_g INT,
  status TEXT NOT NULL DEFAULT '출고됨' CHECK (status IN ('출고됨', '마감완료')),
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.production_logs IS '출고 기록: 생산일자/제품/원료별 출고량, 마감 시 실사용량(g)';
COMMENT ON COLUMN public.production_logs.outbound_lines IS '소비기한별 출고 배열: [{ "소비기한": "YYYY-MM-DD", "박스": 0, "낱개": 0, "g": 0 }]';

-- 4. 원료별 마지막 사용 소비기한 (last_used_dates) - 팝업 기본값용
CREATE TABLE IF NOT EXISTS public.last_used_dates (
  material_name TEXT PRIMARY KEY,
  last_expiry_date DATE NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.last_used_dates IS '원료명별 마지막 입력 소비기한(날짜) - UI 기본값';

-- RLS 정책 (선택): 익명 읽기/쓰기 허용 시 아래 사용
-- 실제 서비스에서는 인증 후 정책을 더 엄격히 설정하세요.
ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.last_used_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for materials" ON public.materials FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for bom" ON public.bom FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for production_logs" ON public.production_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for last_used_dates" ON public.last_used_dates FOR ALL USING (true) WITH CHECK (true);

-- 초기 데이터 (선택): id는 미지정 → 테이블 기본값(gen_random_uuid())으로 자동 생성
INSERT INTO public.materials (material_name, box_weight_g, unit_weight_g) VALUES
  ('AG-91', 10000, 2500),
  ('레드체다치즈', 10000, 2500),
  ('고르곤졸라', 0, 0),
  ('토핑 토마토소스', 10000, 5000),
  ('도우 토마토소스', 10000, 5000)
ON CONFLICT (material_name) DO NOTHING;

INSERT INTO public.bom (product_name, material_name, bom_g_per_ea, basis) VALUES
  ('마르게리따', '토핑 토마토소스', 20, '완제품'),
  ('마르게리따', '도우 토마토소스', 60, '도우'),
  ('파이브치즈', 'AG-91', 75, '완제품')
ON CONFLICT (product_name, material_name, basis) DO NOTHING;
