-- 1차 발주 판단 화면용 원료 발주정책 필드 (materials 직접 확장)

alter table public.materials
  add column if not exists vendor_name text null,
  add column if not exists lead_time_days integer not null default 0,
  add column if not exists safety_stock_g numeric not null default 0,
  add column if not exists order_policy text not null default 'normal',
  add column if not exists order_box_g numeric null,
  add column if not exists order_unit_name text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'materials_order_policy_check'
  ) then
    alter table public.materials
      add constraint materials_order_policy_check
      check (order_policy in ('normal', 'on_demand'));
  end if;
end $$;

create index if not exists materials_vendor_name_idx on public.materials(vendor_name);
create index if not exists materials_lead_time_days_idx on public.materials(lead_time_days);
create index if not exists materials_order_policy_idx on public.materials(order_policy);

