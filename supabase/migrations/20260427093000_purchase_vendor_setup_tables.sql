-- 공급처 마스터 + 공급처별 품목 발주조건 (1차 입력용)

create table if not exists public.purchase_vendors (
  id uuid primary key default gen_random_uuid(),
  vendor_name text not null,
  contact_name text null,
  phone text null,
  email text null,
  note text null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_vendors_vendor_name_uq
  on public.purchase_vendors ((lower(trim(vendor_name))));

create table if not exists public.purchase_vendor_items (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.purchase_vendors(id) on update cascade on delete cascade,
  material_code text null,
  material_name_snapshot text not null,
  material_type text not null,
  order_spec_label text null,
  purchase_unit_weight_g numeric not null default 0,
  purchase_unit_name text null,
  lead_time_days integer not null default 0,
  safety_stock_g numeric not null default 0,
  order_policy text not null default 'normal',
  is_primary_vendor boolean not null default false,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'purchase_vendor_items_material_type_check'
  ) then
    alter table public.purchase_vendor_items
      add constraint purchase_vendor_items_material_type_check
      check (material_type in ('raw_material', 'submaterial'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'purchase_vendor_items_order_policy_check'
  ) then
    alter table public.purchase_vendor_items
      add constraint purchase_vendor_items_order_policy_check
      check (order_policy in ('normal', 'on_demand'));
  end if;
end $$;

create unique index if not exists purchase_vendor_items_vendor_material_code_uq
  on public.purchase_vendor_items(vendor_id, material_type, material_code)
  where material_code is not null;

create unique index if not exists purchase_vendor_items_vendor_material_name_uq
  on public.purchase_vendor_items(vendor_id, material_type, material_name_snapshot)
  where material_code is null;

create unique index if not exists purchase_vendor_items_primary_material_code_uq
  on public.purchase_vendor_items(material_type, material_code)
  where is_primary_vendor = true and material_code is not null;

create unique index if not exists purchase_vendor_items_primary_material_name_uq
  on public.purchase_vendor_items(material_type, material_name_snapshot)
  where is_primary_vendor = true and material_code is null;

create index if not exists purchase_vendor_items_vendor_idx on public.purchase_vendor_items(vendor_id);
create index if not exists purchase_vendor_items_type_idx on public.purchase_vendor_items(material_type);

alter table public.purchase_vendors enable row level security;
alter table public.purchase_vendor_items enable row level security;

