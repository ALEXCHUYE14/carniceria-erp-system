-- =====================================================================
-- CARNICERÍA ERP/POS — ESQUEMA COMPLETO SUPABASE (PostgreSQL 15+)
-- Ejecutar completo en: Supabase Dashboard > SQL Editor > New query
-- Idempotente en lo posible (IF NOT EXISTS / OR REPLACE).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 0. TIPOS ENUMERADOS
-- ---------------------------------------------------------------------
do $$ begin
  create type public.user_role as enum ('admin', 'cajero', 'carnicero');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.species_type as enum ('res', 'cerdo', 'cordero', 'pollo', 'otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.carcass_status as enum ('recibida', 'en_despiece', 'despiezada', 'anulada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lot_status as enum ('activo', 'agotado', 'vencido', 'bloqueado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sale_status as enum ('completada', 'anulada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('efectivo', 'yape', 'plin', 'tarjeta', 'credito');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ledger_type as enum ('cargo', 'abono', 'ajuste');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 1. CONFIGURACIÓN DEL NEGOCIO (fila única id = 1)
-- ---------------------------------------------------------------------
create table if not exists public.business_settings (
  id                    smallint primary key default 1 check (id = 1),
  trade_name            text        not null default 'Mi Carnicería',
  legal_name            text,
  tax_id                text,                               -- RUC / NIT / RFC
  tax_id_label          text        not null default 'RUC',
  currency_code         text        not null default 'PEN',
  currency_symbol       text        not null default 'S/',
  tax_name              text        not null default 'IGV',
  tax_rate              numeric(5,2) not null default 18.00 check (tax_rate >= 0 and tax_rate <= 100),
  prices_include_tax    boolean     not null default true,
  address               text,
  phone                 text,
  ticket_footer         text        default 'Gracias por su compra',
  yape_qr_path          text,                               -- ruta en bucket qr-codes
  yape_holder           text,
  yape_phone            text,
  plin_qr_path          text,
  plin_holder           text,
  plin_phone            text,
  allow_negative_stock  boolean     not null default false,
  default_credit_days   integer     not null default 15 check (default_credit_days >= 0),
  whatsapp_webhook_url  text,                               -- endpoint externo para comprobantes
  updated_at            timestamptz not null default now(),
  updated_by            uuid
);

insert into public.business_settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. PERFILES DE USUARIO
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text        not null default '',
  role        public.user_role not null default 'cajero',
  terminal_id text,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. CATÁLOGO
-- ---------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null unique,
  species     public.species_type,
  image_url   text,
  sort_order  integer     not null default 0,
  active      boolean     not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.products (
  id                 uuid primary key default gen_random_uuid(),
  category_id        uuid references public.categories(id) on delete set null,
  sku                text unique,
  barcode            text unique,
  name               text        not null,
  sell_by_weight     boolean     not null default true,
  unit               text        not null default 'kg' check (unit in ('kg', 'und')),
  price_per_unit     numeric(12,2) not null default 0 check (price_per_unit >= 0),  -- precio por kg o por unidad
  cost_per_unit      numeric(12,4) not null default 0 check (cost_per_unit >= 0),   -- costo ponderado vigente
  stock_actual_kg    numeric(12,3) not null default 0,                              -- stock en kg (o unidades si unit = 'und')
  min_stock_kg       numeric(12,3) not null default 0,
  value_factor       numeric(8,4)  not null default 1 check (value_factor >= 0),    -- peso relativo para prorrateo de costo
  is_commercial_cut  boolean     not null default true,                             -- false para grasa / hueso / merma
  weight_shortcuts   numeric(8,3)[] not null default '{0.25,0.5,1}',
  image_url          text,
  active             boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Tipos de corte / preparación con impacto en merma
create table if not exists public.cut_types (
  id                 uuid primary key default gen_random_uuid(),
  name               text        not null unique,       -- Enchufe, Molida especial, Fileteado fino...
  shrink_pct         numeric(5,2) not null default 0 check (shrink_pct >= 0 and shrink_pct < 100), -- merma por preparación
  surcharge_per_kg   numeric(10,2) not null default 0 check (surcharge_per_kg >= 0),
  active             boolean     not null default true,
  sort_order         integer     not null default 0
);

-- ---------------------------------------------------------------------
-- 4. REGISTRO DE CANALES / RESES Y DESPIECE
-- ---------------------------------------------------------------------
create table if not exists public.carcasses (
  id                 uuid primary key default gen_random_uuid(),
  code               text        not null unique,             -- código interno / tropa
  species            public.species_type not null default 'res',
  carcass_type       text        not null default 'entera' check (carcass_type in ('entera', 'media', 'cuarto_delantero', 'cuarto_trasero')),
  supplier_name      text        not null,
  supplier_tax_id    text,
  truck_plate        text,
  guide_number       text,                                    -- guía de remisión
  senasa_code        text,                                    -- certificado sanitario
  slaughter_date     date        not null,
  received_at        timestamptz not null default now(),
  arrival_temp_c     numeric(4,1),                            -- cadena de frío
  hook_weight_kg     numeric(10,3) not null check (hook_weight_kg > 0),
  total_cost         numeric(12,2) not null check (total_cost >= 0),
  shelf_life_days    integer     not null default 7 check (shelf_life_days > 0),
  status             public.carcass_status not null default 'recibida',
  yield_pct          numeric(6,2),                            -- calculado al cerrar despiece
  commercial_kg      numeric(10,3),
  byproduct_kg       numeric(10,3),
  loss_kg            numeric(10,3),                           -- merma de proceso (gancho - total pesado)
  processed_at       timestamptz,
  processed_by       uuid references public.profiles(id),
  notes              text,
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now()
);

create table if not exists public.cuts_yield_master (
  id                 uuid primary key default gen_random_uuid(),
  carcass_id         uuid        not null references public.carcasses(id) on delete cascade,
  product_id         uuid        not null references public.products(id),
  kg_obtained        numeric(10,3) not null check (kg_obtained >= 0),
  is_commercial      boolean     not null default true,
  value_factor       numeric(8,4)  not null default 1 check (value_factor >= 0),
  allocated_cost     numeric(12,2),
  cost_per_kg        numeric(12,4),
  lot_id             uuid,
  created_at         timestamptz not null default now(),
  unique (carcass_id, product_id)
);

-- ---------------------------------------------------------------------
-- 5. LOTES Y TRAZABILIDAD
-- ---------------------------------------------------------------------
create table if not exists public.inventory_lots (
  id                 uuid primary key default gen_random_uuid(),
  lot_number         text        not null unique,
  product_id         uuid        not null references public.products(id),
  carcass_id         uuid references public.carcasses(id) on delete set null,
  supplier_name      text,
  senasa_registry    text,
  slaughter_date     date,
  expiry_date        date,
  received_at        timestamptz not null default now(),
  storage_temp_c     numeric(4,1),
  initial_kg         numeric(12,3) not null check (initial_kg > 0),
  remaining_kg       numeric(12,3) not null,
  unit_cost          numeric(12,4) not null default 0,
  status             public.lot_status not null default 'activo',
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  check (remaining_kg >= 0 and remaining_kg <= initial_kg)
);

alter table public.cuts_yield_master
  drop constraint if exists cuts_yield_master_lot_fk;
alter table public.cuts_yield_master
  add constraint cuts_yield_master_lot_fk foreign key (lot_id) references public.inventory_lots(id) on delete set null;

-- ---------------------------------------------------------------------
-- 6. CLIENTES Y CUENTA CORRIENTE
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id                 uuid primary key default gen_random_uuid(),
  doc_type           text        not null default 'DNI' check (doc_type in ('DNI', 'RUC', 'CE', 'OTRO')),
  doc_number         text,
  full_name          text        not null,
  phone              text,
  address            text,
  credit_enabled     boolean     not null default false,
  credit_limit       numeric(12,2) not null default 0 check (credit_limit >= 0),
  credit_days        integer     not null default 15 check (credit_days >= 0),
  balance            numeric(12,2) not null default 0,       -- saldo deudor (mantenido por trigger)
  oldest_due_date    date,                                    -- vencimiento más antiguo pendiente (trigger)
  active             boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (doc_type, doc_number)
);

-- ---------------------------------------------------------------------
-- 7. VENTAS
-- ---------------------------------------------------------------------
create sequence if not exists public.sale_number_seq start 1;

create table if not exists public.sales (
  id                 uuid primary key default gen_random_uuid(),
  client_uuid        uuid        not null unique,             -- idempotencia offline
  sale_number        bigint      not null unique default nextval('public.sale_number_seq'),
  customer_id        uuid references public.customers(id),
  cashier_id         uuid        not null references public.profiles(id) default auth.uid(),
  terminal_id        text,
  subtotal           numeric(12,2) not null default 0,
  tax_amount         numeric(12,2) not null default 0,
  discount           numeric(12,2) not null default 0 check (discount >= 0),
  total              numeric(12,2) not null default 0 check (total >= 0),
  status             public.sale_status not null default 'completada',
  voided_at          timestamptz,
  voided_by          uuid references public.profiles(id),
  void_reason        text,
  offline_created_at timestamptz,                             -- hora real en el terminal si fue offline
  created_at         timestamptz not null default now()
);

create table if not exists public.sale_items (
  id                 uuid primary key default gen_random_uuid(),
  sale_id            uuid        not null references public.sales(id) on delete cascade,
  product_id         uuid        not null references public.products(id),
  lot_id             uuid references public.inventory_lots(id),  -- si null, FIFO automático
  cut_type_id        uuid references public.cut_types(id),
  quantity           numeric(12,3) not null check (quantity > 0),  -- kg netos entregados (o unidades)
  shrink_kg          numeric(12,3) not null default 0 check (shrink_kg >= 0), -- merma por preparación
  unit_price         numeric(12,2) not null check (unit_price >= 0),
  surcharge          numeric(12,2) not null default 0,
  unit_cost          numeric(12,4) not null default 0,
  line_total         numeric(12,2) not null check (line_total >= 0),
  weight_source      text        not null default 'manual' check (weight_source in ('manual', 'scale', 'shortcut')),
  created_at         timestamptz not null default now()
);

-- Asignación real a lotes (trazabilidad corte vendido -> lote -> canal -> proveedor)
create table if not exists public.sale_item_lots (
  id                 uuid primary key default gen_random_uuid(),
  sale_item_id       uuid        not null references public.sale_items(id) on delete cascade,
  lot_id             uuid        not null references public.inventory_lots(id),
  kg                 numeric(12,3) not null check (kg > 0),
  created_at         timestamptz not null default now()
);

create table if not exists public.payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  sale_id            uuid references public.sales(id) on delete cascade,
  customer_id        uuid references public.customers(id),
  method             public.payment_method not null,
  amount             numeric(12,2) not null check (amount > 0),
  tendered           numeric(12,2),                           -- efectivo entregado
  change_given       numeric(12,2),
  operation_number   text,                                    -- nro. operación Yape/Plin/voucher
  verified           boolean     not null default false,
  verified_by        uuid references public.profiles(id),
  verified_at        timestamptz,
  received_by        uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now(),
  check (method not in ('yape', 'plin') or coalesce(length(trim(operation_number)), 0) >= 4)
);

create table if not exists public.customer_ledger (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid        not null references public.customers(id) on delete cascade,
  sale_id            uuid references public.sales(id),
  payment_id         uuid references public.payment_transactions(id),
  entry_type         public.ledger_type not null,
  amount             numeric(12,2) not null check (amount <> 0),
  due_date           date,
  note               text,
  created_by         uuid references public.profiles(id) default auth.uid(),
  created_at         timestamptz not null default now()
);

-- Cola de notificaciones (WhatsApp) consumida por Edge Function / webhook
create table if not exists public.notification_outbox (
  id                 uuid primary key default gen_random_uuid(),
  channel            text        not null default 'whatsapp',
  customer_id        uuid references public.customers(id),
  phone              text,
  template           text        not null,
  payload            jsonb       not null default '{}'::jsonb,
  status             text        not null default 'pendiente' check (status in ('pendiente', 'enviado', 'error')),
  attempts           integer     not null default 0,
  last_error         text,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);

-- Auditoría de movimientos de stock
create table if not exists public.stock_movements (
  id                 bigint generated always as identity primary key,
  product_id         uuid        not null references public.products(id),
  lot_id             uuid references public.inventory_lots(id),
  movement           text        not null check (movement in ('entrada_lote', 'venta', 'anulacion', 'ajuste', 'merma')),
  kg                 numeric(12,3) not null,                  -- positivo entra, negativo sale
  ref_id             uuid,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 8. ÍNDICES
-- ---------------------------------------------------------------------
create index if not exists idx_products_category      on public.products using btree (category_id);
create index if not exists idx_products_active_name   on public.products using btree (active, name);
create index if not exists idx_cuts_yield_carcass      on public.cuts_yield_master using btree (carcass_id);
create index if not exists idx_cuts_yield_product      on public.cuts_yield_master using btree (product_id);
create index if not exists idx_lots_product_fifo       on public.inventory_lots using btree (product_id, status, expiry_date, received_at);
create index if not exists idx_lots_lot_number         on public.inventory_lots using btree (lot_number);
create index if not exists idx_lots_carcass            on public.inventory_lots using btree (carcass_id);
create index if not exists idx_lots_created_at         on public.inventory_lots using btree (created_at);
create index if not exists idx_carcasses_created_at    on public.carcasses using btree (created_at);
create index if not exists idx_sales_created_at        on public.sales using btree (created_at desc);
create index if not exists idx_sales_customer          on public.sales using btree (customer_id);
create index if not exists idx_sales_cashier_date      on public.sales using btree (cashier_id, created_at desc);
create index if not exists idx_sale_items_sale         on public.sale_items using btree (sale_id);
create index if not exists idx_sale_items_product      on public.sale_items using btree (product_id);
create index if not exists idx_sale_items_created_at   on public.sale_items using btree (created_at);
create index if not exists idx_sale_item_lots_lot      on public.sale_item_lots using btree (lot_id);
create index if not exists idx_sale_item_lots_item     on public.sale_item_lots using btree (sale_item_id);
create index if not exists idx_payments_sale           on public.payment_transactions using btree (sale_id);
create index if not exists idx_payments_created_at     on public.payment_transactions using btree (created_at);
create index if not exists idx_payments_operation      on public.payment_transactions using btree (method, operation_number);
create index if not exists idx_ledger_customer_date    on public.customer_ledger using btree (customer_id, created_at);
create index if not exists idx_customers_name          on public.customers using btree (full_name);
create index if not exists idx_stock_mov_product_date  on public.stock_movements using btree (product_id, created_at);
create index if not exists idx_outbox_status           on public.notification_outbox using btree (status, created_at);

-- Evita reutilizar el mismo nro de operación Yape/Plin en pagos distintos (anti-fraude)
create unique index if not exists uq_wallet_operation
  on public.payment_transactions (method, operation_number)
  where method in ('yape', 'plin');

-- ---------------------------------------------------------------------
-- 9. FUNCIONES AUXILIARES DE ROL
-- ---------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid() and active = true), false);
$$;

create or replace function public.is_active_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active = true);
$$;

create or replace function public.has_role(roles public.user_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((select role = any(roles) from public.profiles where id = auth.uid() and active = true), false);
$$;

-- Perfil automático al registrarse. El primer usuario del sistema es admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  else
    v_role := 'cajero';
  end if;
  insert into public.profiles (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), v_role)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at genérico
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_products_touch on public.products;
create trigger trg_products_touch before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_customers_touch on public.customers;
create trigger trg_customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_settings_touch on public.business_settings;
create trigger trg_settings_touch before update on public.business_settings
  for each row execute function public.touch_updated_at();

-- Evita que un no-admin se cambie su propio rol
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active)
     and auth.uid() is not null          -- SQL Editor / service_role no tienen uid
     and not public.is_admin() then
    raise exception 'Solo un administrador puede cambiar roles o estado de usuarios';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------
-- 10. TRIGGERS DE INVENTARIO
-- ---------------------------------------------------------------------

-- 10.1 Entrada de lote -> suma stock del producto y recalcula costo ponderado
create or replace function public.trg_lot_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_stock numeric(12,3);
  v_cost  numeric(12,4);
begin
  select stock_actual_kg, cost_per_unit into v_stock, v_cost
  from public.products where id = new.product_id for update;

  update public.products
     set stock_actual_kg = stock_actual_kg + new.initial_kg,
         cost_per_unit = case
           when greatest(v_stock, 0) + new.initial_kg > 0
             then round(((greatest(v_stock, 0) * v_cost) + (new.initial_kg * new.unit_cost)) / (greatest(v_stock, 0) + new.initial_kg), 4)
           else new.unit_cost end
   where id = new.product_id;

  insert into public.stock_movements (product_id, lot_id, movement, kg, ref_id)
  values (new.product_id, new.id, 'entrada_lote', new.initial_kg, new.carcass_id);
  return new;
end;
$$;

drop trigger if exists trg_inventory_lots_ai on public.inventory_lots;
create trigger trg_inventory_lots_ai after insert on public.inventory_lots
  for each row execute function public.trg_lot_after_insert();

-- 10.2 Venta de ítem -> descuenta stock_actual_kg y consume lotes FIFO
create or replace function public.trg_sale_item_after_insert()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_needed      numeric(12,3);
  v_take        numeric(12,3);
  v_lot         record;
  v_allow_neg   boolean;
  v_stock       numeric(12,3);
  v_name        text;
begin
  v_needed := new.quantity + new.shrink_kg;   -- se descuenta lo entregado + la merma de preparación

  select stock_actual_kg, name into v_stock, v_name
  from public.products where id = new.product_id for update;

  select allow_negative_stock into v_allow_neg from public.business_settings where id = 1;

  if v_stock < v_needed and not coalesce(v_allow_neg, false) then
    raise exception 'Stock insuficiente para "%": disponible % , requerido %', v_name, v_stock, v_needed
      using errcode = 'P0001';
  end if;

  update public.products
     set stock_actual_kg = stock_actual_kg - v_needed
   where id = new.product_id;

  -- Lote específico elegido primero, luego FIFO por vencimiento y fecha de ingreso
  for v_lot in
    select id, remaining_kg
      from public.inventory_lots
     where product_id = new.product_id
       and status = 'activo'
       and remaining_kg > 0
     order by (id = new.lot_id) desc nulls last,
              expiry_date asc nulls last,
              received_at asc
     for update
  loop
    exit when v_needed <= 0;
    v_take := least(v_lot.remaining_kg, v_needed);

    update public.inventory_lots
       set remaining_kg = remaining_kg - v_take,
           status = case when remaining_kg - v_take <= 0 then 'agotado'::public.lot_status else status end
     where id = v_lot.id;

    insert into public.sale_item_lots (sale_item_id, lot_id, kg) values (new.id, v_lot.id, v_take);
    insert into public.stock_movements (product_id, lot_id, movement, kg, ref_id)
    values (new.product_id, v_lot.id, 'venta', -v_take, new.sale_id);

    v_needed := v_needed - v_take;
  end loop;

  -- Remanente sin lote (stock negativo permitido): se registra el movimiento sin lote
  if v_needed > 0 then
    insert into public.stock_movements (product_id, lot_id, movement, kg, ref_id)
    values (new.product_id, null, 'venta', -v_needed, new.sale_id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sale_items_ai on public.sale_items;
create trigger trg_sale_items_ai after insert on public.sale_items
  for each row execute function public.trg_sale_item_after_insert();

-- 10.3 Marca lotes vencidos (llamar a diario vía pg_cron o manualmente)
create or replace function public.expire_lots()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  update public.inventory_lots
     set status = 'vencido'
   where status = 'activo' and expiry_date is not null and expiry_date < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. TRIGGER DE SALDO DE CLIENTE
-- ---------------------------------------------------------------------
create or replace function public.recalc_customer_balance(p_customer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_balance numeric(12,2);
  v_oldest  date;
begin
  select coalesce(sum(case entry_type when 'cargo' then amount
                                      when 'abono' then -amount
                                      else amount end), 0)
    into v_balance
    from public.customer_ledger
   where customer_id = p_customer_id;

  -- Vencimiento pendiente más antiguo: cargos no cubiertos por abonos (aplicación FIFO)
  with cargos as (
    select due_date, amount,
           sum(amount) over (order by created_at, id) as acumulado
      from public.customer_ledger
     where customer_id = p_customer_id and entry_type = 'cargo'
  ), pagado as (
    select coalesce(sum(case entry_type when 'abono' then amount
                                        when 'ajuste' then -amount else 0 end), 0) as total
      from public.customer_ledger
     where customer_id = p_customer_id and entry_type in ('abono', 'ajuste')
  )
  select min(c.due_date) into v_oldest
    from cargos c, pagado p
   where c.acumulado > p.total;

  update public.customers
     set balance = v_balance,
         oldest_due_date = case when v_balance > 0 then v_oldest else null end
   where id = p_customer_id;
end;
$$;

create or replace function public.trg_ledger_after_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.recalc_customer_balance(old.customer_id);
    return old;
  end if;
  perform public.recalc_customer_balance(new.customer_id);
  if tg_op = 'UPDATE' and new.customer_id <> old.customer_id then
    perform public.recalc_customer_balance(old.customer_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_customer_ledger_aiud on public.customer_ledger;
create trigger trg_customer_ledger_aiud after insert or update or delete on public.customer_ledger
  for each row execute function public.trg_ledger_after_change();

-- ---------------------------------------------------------------------
-- 12. RPC: CREAR VENTA ATÓMICA (idempotente para sincronización offline)
-- payload:
-- {
--   "client_uuid": "uuid", "customer_id": "uuid|null", "terminal_id": "CAJA-1",
--   "discount": 0, "offline_created_at": "iso|null",
--   "items": [{ "product_id", "lot_id", "cut_type_id", "quantity", "unit_price", "weight_source" }],
--   "payments": [{ "method", "amount", "tendered", "operation_number" }]
-- }
-- ---------------------------------------------------------------------
create or replace function public.create_sale(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_existing    public.sales%rowtype;
  v_sale_id     uuid;
  v_sale_number bigint;
  v_item        jsonb;
  v_pay         jsonb;
  v_prod        record;
  v_cut         record;
  v_qty         numeric(12,3);
  v_shrink      numeric(12,3);
  v_surcharge   numeric(12,2);
  v_line        numeric(12,2);
  v_gross       numeric(12,2) := 0;
  v_discount    numeric(12,2) := coalesce((payload->>'discount')::numeric, 0);
  v_total       numeric(12,2);
  v_paid        numeric(12,2) := 0;
  v_credit      numeric(12,2) := 0;
  v_settings    public.business_settings%rowtype;
  v_customer    public.customers%rowtype;
  v_subtotal    numeric(12,2);
  v_tax         numeric(12,2);
  v_pay_id      uuid;
begin
  if not public.has_role(array['admin', 'cajero']::public.user_role[]) then
    raise exception 'No autorizado para registrar ventas' using errcode = '42501';
  end if;

  -- Idempotencia: si la venta ya existe (reintento offline) se devuelve tal cual
  select * into v_existing from public.sales where client_uuid = (payload->>'client_uuid')::uuid;
  if found then
    return jsonb_build_object('sale_id', v_existing.id, 'sale_number', v_existing.sale_number,
                              'total', v_existing.total, 'duplicate', true);
  end if;

  if jsonb_array_length(coalesce(payload->'items', '[]'::jsonb)) = 0 then
    raise exception 'La venta no tiene ítems';
  end if;

  select * into v_settings from public.business_settings where id = 1;

  insert into public.sales (client_uuid, customer_id, cashier_id, terminal_id, discount, offline_created_at)
  values ((payload->>'client_uuid')::uuid,
          nullif(payload->>'customer_id', '')::uuid,
          auth.uid(),
          payload->>'terminal_id',
          v_discount,
          nullif(payload->>'offline_created_at', '')::timestamptz)
  returning id, sale_number into v_sale_id, v_sale_number;

  -- Ítems: el precio se toma del payload (precio vigente en el terminal) pero se valida > 0
  for v_item in select * from jsonb_array_elements(payload->'items')
  loop
    select id, name, price_per_unit, cost_per_unit, sell_by_weight, active
      into v_prod
      from public.products where id = (v_item->>'product_id')::uuid;
    if not found or not v_prod.active then
      raise exception 'Producto inválido o inactivo: %', v_item->>'product_id';
    end if;

    v_qty := round((v_item->>'quantity')::numeric, 3);
    if v_qty <= 0 then raise exception 'Cantidad inválida para %', v_prod.name; end if;
    if not v_prod.sell_by_weight and v_qty <> trunc(v_qty) then
      raise exception '"%" se vende por unidad entera', v_prod.name;
    end if;

    v_shrink := 0; v_surcharge := 0;
    if nullif(v_item->>'cut_type_id', '') is not null then
      select shrink_pct, surcharge_per_kg into v_cut
        from public.cut_types where id = (v_item->>'cut_type_id')::uuid and active;
      if found then
        -- merma: kg brutos necesarios para entregar v_qty netos = qty / (1 - pct) - qty
        v_shrink := round(v_qty / (1 - v_cut.shrink_pct / 100.0) - v_qty, 3);
        v_surcharge := round(v_cut.surcharge_per_kg * v_qty, 2);
      end if;
    end if;

    v_line := round(v_qty * coalesce((v_item->>'unit_price')::numeric, v_prod.price_per_unit), 2) + v_surcharge;

    insert into public.sale_items (sale_id, product_id, lot_id, cut_type_id, quantity, shrink_kg,
                                   unit_price, surcharge, unit_cost, line_total, weight_source)
    values (v_sale_id, v_prod.id, nullif(v_item->>'lot_id', '')::uuid, nullif(v_item->>'cut_type_id', '')::uuid,
            v_qty, v_shrink, coalesce((v_item->>'unit_price')::numeric, v_prod.price_per_unit),
            v_surcharge, v_prod.cost_per_unit, v_line, coalesce(v_item->>'weight_source', 'manual'));

    v_gross := v_gross + v_line;
  end loop;

  v_total := greatest(v_gross - v_discount, 0);

  if v_settings.prices_include_tax then
    v_subtotal := round(v_total / (1 + v_settings.tax_rate / 100.0), 2);
    v_tax := v_total - v_subtotal;
  else
    v_subtotal := v_total;
    v_tax := round(v_total * v_settings.tax_rate / 100.0, 2);
    v_total := v_subtotal + v_tax;
  end if;

  update public.sales set subtotal = v_subtotal, tax_amount = v_tax, total = v_total where id = v_sale_id;

  -- Pagos
  for v_pay in select * from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb))
  loop
    if (v_pay->>'amount')::numeric <= 0 then continue; end if;

    insert into public.payment_transactions (sale_id, customer_id, method, amount, tendered, change_given, operation_number)
    values (v_sale_id,
            nullif(payload->>'customer_id', '')::uuid,
            (v_pay->>'method')::public.payment_method,
            (v_pay->>'amount')::numeric,
            nullif(v_pay->>'tendered', '')::numeric,
            case when v_pay->>'tendered' is not null
                 then greatest((v_pay->>'tendered')::numeric - (v_pay->>'amount')::numeric, 0) end,
            nullif(trim(v_pay->>'operation_number'), ''))
    returning id into v_pay_id;

    if v_pay->>'method' = 'credito' then
      v_credit := v_credit + (v_pay->>'amount')::numeric;
    end if;
    v_paid := v_paid + (v_pay->>'amount')::numeric;
  end loop;

  if round(v_paid, 2) < round(v_total, 2) then
    raise exception 'Pago incompleto: total % , pagado %', v_total, v_paid;
  end if;

  -- Fiado: valida límite y genera cargo en la cuenta corriente
  if v_credit > 0 then
    select * into v_customer from public.customers where id = nullif(payload->>'customer_id', '')::uuid for update;
    if not found then raise exception 'Venta al crédito requiere un cliente'; end if;
    if not v_customer.credit_enabled then raise exception 'El cliente % no tiene crédito habilitado', v_customer.full_name; end if;
    if v_customer.balance + v_credit > v_customer.credit_limit then
      raise exception 'Límite de crédito excedido para %: saldo % + % > límite %',
        v_customer.full_name, v_customer.balance, v_credit, v_customer.credit_limit;
    end if;
    if v_customer.oldest_due_date is not null and v_customer.oldest_due_date < current_date and not public.is_admin() then
      raise exception 'El cliente % tiene saldo vencido desde %; requiere autorización de administrador',
        v_customer.full_name, v_customer.oldest_due_date;
    end if;

    insert into public.customer_ledger (customer_id, sale_id, entry_type, amount, due_date, note)
    values (v_customer.id, v_sale_id, 'cargo', v_credit, current_date + v_customer.credit_days,
            'Venta N° ' || v_sale_number);
  end if;

  return jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number,
                            'subtotal', v_subtotal, 'tax', v_tax, 'total', v_total,
                            'change', greatest(v_paid - v_total, 0), 'duplicate', false);
end;
$$;

-- ---------------------------------------------------------------------
-- 13. RPC: ANULAR VENTA (solo admin) — revierte stock y cuenta corriente
-- ---------------------------------------------------------------------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_row  record;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede anular ventas' using errcode = '42501';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_sale.status = 'anulada' then raise exception 'La venta ya está anulada'; end if;

  -- Devuelve kg a los lotes consumidos
  for v_row in
    select sil.lot_id, sil.kg, si.product_id
      from public.sale_item_lots sil
      join public.sale_items si on si.id = sil.sale_item_id
     where si.sale_id = p_sale_id
  loop
    update public.inventory_lots
       set remaining_kg = least(remaining_kg + v_row.kg, initial_kg),
           status = case when status = 'agotado' then 'activo'::public.lot_status else status end
     where id = v_row.lot_id;
    insert into public.stock_movements (product_id, lot_id, movement, kg, ref_id)
    values (v_row.product_id, v_row.lot_id, 'anulacion', v_row.kg, p_sale_id);
  end loop;

  -- Devuelve stock total del producto (incluye remanentes sin lote)
  update public.products p
     set stock_actual_kg = p.stock_actual_kg + t.kg
    from (select product_id, sum(quantity + shrink_kg) as kg
            from public.sale_items where sale_id = p_sale_id group by product_id) t
   where p.id = t.product_id;

  -- Revierte cargo de fiado
  insert into public.customer_ledger (customer_id, sale_id, entry_type, amount, note)
  select customer_id, sale_id, 'ajuste', -amount, 'Anulación venta N° ' || v_sale.sale_number
    from public.customer_ledger
   where sale_id = p_sale_id and entry_type = 'cargo';

  update public.sales
     set status = 'anulada', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
   where id = p_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. RPC: REGISTRAR ABONO DE CLIENTE (+ comprobante WhatsApp en cola)
-- ---------------------------------------------------------------------
create or replace function public.register_customer_payment(
  p_customer_id uuid, p_amount numeric, p_method public.payment_method,
  p_operation_number text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_pay_id   uuid;
  v_customer public.customers%rowtype;
begin
  if not public.has_role(array['admin', 'cajero']::public.user_role[]) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  if p_amount <= 0 then raise exception 'Monto inválido'; end if;
  if p_method = 'credito' then raise exception 'Un abono no puede ser al crédito'; end if;

  select * into v_customer from public.customers where id = p_customer_id for update;
  if not found then raise exception 'Cliente no encontrado'; end if;
  if p_amount > v_customer.balance then
    raise exception 'El abono (%) supera el saldo pendiente (%)', p_amount, v_customer.balance;
  end if;

  insert into public.payment_transactions (customer_id, method, amount, operation_number)
  values (p_customer_id, p_method, p_amount, nullif(trim(p_operation_number), ''))
  returning id into v_pay_id;

  insert into public.customer_ledger (customer_id, payment_id, entry_type, amount, note)
  values (p_customer_id, v_pay_id, 'abono', p_amount, coalesce(p_note, 'Abono ' || p_method));

  select * into v_customer from public.customers where id = p_customer_id;

  if v_customer.phone is not null then
    insert into public.notification_outbox (customer_id, phone, template, payload)
    values (p_customer_id, v_customer.phone, 'comprobante_abono',
            jsonb_build_object('cliente', v_customer.full_name, 'monto', p_amount,
                               'metodo', p_method, 'saldo', v_customer.balance, 'fecha', now()));
  end if;

  return jsonb_build_object('payment_id', v_pay_id, 'new_balance', v_customer.balance);
end;
$$;

-- Genera recordatorios de saldo vencido (programable con pg_cron)
create or replace function public.enqueue_overdue_reminders()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  insert into public.notification_outbox (customer_id, phone, template, payload)
  select c.id, c.phone, 'recordatorio_vencido',
         jsonb_build_object('cliente', c.full_name, 'saldo', c.balance, 'vencido_desde', c.oldest_due_date)
    from public.customers c
   where c.balance > 0 and c.oldest_due_date < current_date and c.phone is not null
     and not exists (select 1 from public.notification_outbox o
                      where o.customer_id = c.id and o.template = 'recordatorio_vencido'
                        and o.created_at > now() - interval '3 days');
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 15. RPC: CERRAR DESPIECE — rendimiento, prorrateo de costo y lotes
-- Rendimiento (%) = Σ kg cortes comerciales / kg canal × 100
-- Costo por corte = costo total × (kg_i × factor_i) / Σ(kg_j × factor_j)   (solo comerciales)
-- Subproductos (grasa/hueso) se ingresan a costo 0 (su valor queda absorbido por los cortes)
-- ---------------------------------------------------------------------
create or replace function public.process_carcass(p_carcass_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_c            public.carcasses%rowtype;
  v_commercial   numeric(12,3);
  v_byproduct    numeric(12,3);
  v_weighted     numeric(18,6);
  v_row          record;
  v_alloc        numeric(12,2);
  v_alloc_sum    numeric(12,2) := 0;
  v_last_id      uuid;
  v_lot_id       uuid;
  v_seq          integer := 0;
begin
  if not public.has_role(array['admin', 'carnicero']::public.user_role[]) then
    raise exception 'No autorizado para cerrar despiece' using errcode = '42501';
  end if;

  select * into v_c from public.carcasses where id = p_carcass_id for update;
  if not found then raise exception 'Canal no encontrada'; end if;
  if v_c.status = 'despiezada' then raise exception 'La canal % ya fue despiezada', v_c.code; end if;

  select coalesce(sum(kg_obtained) filter (where is_commercial), 0),
         coalesce(sum(kg_obtained) filter (where not is_commercial), 0),
         coalesce(sum(kg_obtained * value_factor) filter (where is_commercial), 0)
    into v_commercial, v_byproduct, v_weighted
    from public.cuts_yield_master where carcass_id = p_carcass_id;

  if v_commercial <= 0 then raise exception 'Registre al menos un corte comercial'; end if;
  if v_commercial + v_byproduct > v_c.hook_weight_kg * 1.02 then
    raise exception 'Los kg despiezados (%) superan el peso en gancho (%)', v_commercial + v_byproduct, v_c.hook_weight_kg;
  end if;
  if v_weighted <= 0 then raise exception 'Los factores de valor comercial deben ser mayores a 0'; end if;

  select id into v_last_id from public.cuts_yield_master
   where carcass_id = p_carcass_id and is_commercial and kg_obtained > 0
   order by kg_obtained * value_factor desc limit 1;

  for v_row in
    select * from public.cuts_yield_master
     where carcass_id = p_carcass_id and kg_obtained > 0
     order by is_commercial desc, id
  loop
    v_seq := v_seq + 1;
    if v_row.is_commercial then
      if v_row.id = v_last_id then
        v_alloc := null; -- se asigna al final para cuadrar redondeos
      else
        v_alloc := round(v_c.total_cost * (v_row.kg_obtained * v_row.value_factor) / v_weighted, 2);
        v_alloc_sum := v_alloc_sum + v_alloc;
      end if;
    else
      v_alloc := 0;
    end if;

    if v_alloc is not null then
      update public.cuts_yield_master
         set allocated_cost = v_alloc,
             cost_per_kg = round(v_alloc / v_row.kg_obtained, 4)
       where id = v_row.id;
    end if;
  end loop;

  -- Cuadre: el corte de mayor valor absorbe la diferencia de redondeo
  update public.cuts_yield_master
     set allocated_cost = v_c.total_cost - v_alloc_sum,
         cost_per_kg = round((v_c.total_cost - v_alloc_sum) / kg_obtained, 4)
   where id = v_last_id;

  -- Crear un lote por corte (trazabilidad canal -> corte)
  v_seq := 0;
  for v_row in
    select * from public.cuts_yield_master
     where carcass_id = p_carcass_id and kg_obtained > 0
     order by is_commercial desc, id
  loop
    v_seq := v_seq + 1;
    insert into public.inventory_lots (lot_number, product_id, carcass_id, supplier_name, senasa_registry,
                                       slaughter_date, expiry_date, storage_temp_c, initial_kg, remaining_kg, unit_cost)
    values (v_c.code || '-' || lpad(v_seq::text, 2, '0'), v_row.product_id, v_c.id, v_c.supplier_name, v_c.senasa_code,
            v_c.slaughter_date, v_c.slaughter_date + v_c.shelf_life_days, v_c.arrival_temp_c,
            v_row.kg_obtained, v_row.kg_obtained, coalesce(v_row.cost_per_kg, 0))
    returning id into v_lot_id;

    update public.cuts_yield_master set lot_id = v_lot_id where id = v_row.id;
  end loop;

  update public.carcasses
     set status = 'despiezada',
         commercial_kg = v_commercial,
         byproduct_kg = v_byproduct,
         loss_kg = greatest(hook_weight_kg - v_commercial - v_byproduct, 0),
         yield_pct = round(v_commercial / hook_weight_kg * 100, 2),
         processed_at = now(),
         processed_by = auth.uid()
   where id = p_carcass_id;

  return jsonb_build_object('carcass_id', p_carcass_id,
                            'yield_pct', round(v_commercial / v_c.hook_weight_kg * 100, 2),
                            'commercial_kg', v_commercial, 'byproduct_kg', v_byproduct,
                            'loss_kg', greatest(v_c.hook_weight_kg - v_commercial - v_byproduct, 0));
end;
$$;

-- ---------------------------------------------------------------------
-- 16. VISTAS DE ANÁLISIS (security_invoker para respetar RLS)
-- ---------------------------------------------------------------------
create or replace view public.v_carcass_yield with (security_invoker = true) as
select c.id, c.code, c.species, c.supplier_name, c.slaughter_date, c.hook_weight_kg, c.total_cost,
       c.commercial_kg, c.byproduct_kg, c.loss_kg, c.yield_pct, c.status, c.processed_at,
       round(c.total_cost / nullif(c.commercial_kg, 0), 4) as real_cost_per_commercial_kg
  from public.carcasses c;

create or replace view public.v_lot_traceability with (security_invoker = true) as
select l.id as lot_id, l.lot_number, p.name as product_name, l.initial_kg, l.remaining_kg, l.unit_cost,
       l.status, l.expiry_date, l.slaughter_date, l.senasa_registry, l.supplier_name,
       c.code as carcass_code, c.truck_plate, c.guide_number, c.arrival_temp_c,
       coalesce((select sum(kg) from public.sale_item_lots s where s.lot_id = l.id), 0) as sold_kg
  from public.inventory_lots l
  join public.products p on p.id = l.product_id
  left join public.carcasses c on c.id = l.carcass_id;

create or replace view public.v_low_stock with (security_invoker = true) as
select id, name, stock_actual_kg, min_stock_kg
  from public.products
 where active and min_stock_kg > 0 and stock_actual_kg <= min_stock_kg;

create or replace view public.v_daily_sales with (security_invoker = true) as
select (s.created_at at time zone 'America/Lima')::date as day,
       count(*) filter (where s.status = 'completada') as tickets,
       coalesce(sum(s.total) filter (where s.status = 'completada'), 0) as total,
       coalesce(sum(si_cost.cost) filter (where s.status = 'completada'), 0) as cost
  from public.sales s
  left join lateral (select sum(si.unit_cost * (si.quantity + si.shrink_kg)) as cost
                       from public.sale_items si where si.sale_id = s.id) si_cost on true
 group by 1;

-- ---------------------------------------------------------------------
-- 17. ROW LEVEL SECURITY
-- Roles: admin (acceso total) | cajero (lee catálogo, INSERTA ventas vía RPC)
--        | carnicero (despiece y lotes)
-- ---------------------------------------------------------------------
alter table public.business_settings    enable row level security;
alter table public.profiles             enable row level security;
alter table public.categories           enable row level security;
alter table public.products             enable row level security;
alter table public.cut_types            enable row level security;
alter table public.carcasses            enable row level security;
alter table public.cuts_yield_master    enable row level security;
alter table public.inventory_lots       enable row level security;
alter table public.customers            enable row level security;
alter table public.customer_ledger      enable row level security;
alter table public.sales                enable row level security;
alter table public.sale_items           enable row level security;
alter table public.sale_item_lots       enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.notification_outbox  enable row level security;
alter table public.stock_movements      enable row level security;

-- Limpieza de políticas previas (re-ejecución segura)
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
           and tablename in ('business_settings','profiles','categories','products','cut_types','carcasses',
                             'cuts_yield_master','inventory_lots','customers','customer_ledger','sales',
                             'sale_items','sale_item_lots','payment_transactions','notification_outbox','stock_movements')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- business_settings
create policy settings_select_staff on public.business_settings for select to authenticated using (public.is_active_staff());
create policy settings_admin_update on public.business_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy profiles_select_self_or_admin on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- catálogo: todo el personal lee; admin escribe
create policy categories_select on public.categories for select to authenticated using (public.is_active_staff());
create policy categories_admin  on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_select   on public.products   for select to authenticated using (public.is_active_staff());
create policy products_admin    on public.products   for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy cut_types_select  on public.cut_types  for select to authenticated using (public.is_active_staff());
create policy cut_types_admin   on public.cut_types  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- despiece: admin + carnicero
create policy carcasses_select on public.carcasses for select to authenticated
  using (public.has_role(array['admin','carnicero']::public.user_role[]));
create policy carcasses_insert on public.carcasses for insert to authenticated
  with check (public.has_role(array['admin','carnicero']::public.user_role[]));
create policy carcasses_update on public.carcasses for update to authenticated
  using (public.is_admin() or (public.has_role(array['carnicero']::public.user_role[]) and status <> 'despiezada'))
  with check (public.has_role(array['admin','carnicero']::public.user_role[]));
create policy carcasses_admin_delete on public.carcasses for delete to authenticated using (public.is_admin());

create policy cuts_select on public.cuts_yield_master for select to authenticated
  using (public.has_role(array['admin','carnicero']::public.user_role[]));
create policy cuts_write on public.cuts_yield_master for all to authenticated
  using (public.has_role(array['admin','carnicero']::public.user_role[])
         and exists (select 1 from public.carcasses c where c.id = carcass_id and c.status <> 'despiezada'))
  with check (public.has_role(array['admin','carnicero']::public.user_role[])
         and exists (select 1 from public.carcasses c where c.id = carcass_id and c.status <> 'despiezada'));

-- lotes: todo el personal lee (FIFO en POS); admin/carnicero crean; admin modifica
create policy lots_select on public.inventory_lots for select to authenticated using (public.is_active_staff());
create policy lots_insert on public.inventory_lots for insert to authenticated
  with check (public.has_role(array['admin','carnicero']::public.user_role[]));
create policy lots_admin_update on public.inventory_lots for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy lots_admin_delete on public.inventory_lots for delete to authenticated using (public.is_admin());

-- clientes: cajero lee y crea; admin total
create policy customers_select on public.customers for select to authenticated
  using (public.has_role(array['admin','cajero']::public.user_role[]));
create policy customers_insert on public.customers for insert to authenticated
  with check (public.has_role(array['admin','cajero']::public.user_role[]) and (credit_limit = 0 or public.is_admin()));
create policy customers_admin_update on public.customers for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy customers_admin_delete on public.customers for delete to authenticated using (public.is_admin());

create policy ledger_select on public.customer_ledger for select to authenticated
  using (public.has_role(array['admin','cajero']::public.user_role[]));
create policy ledger_admin on public.customer_ledger for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ventas: cajero SOLO inserta y ve sus propias ventas; admin total
create policy sales_insert_cashier on public.sales for insert to authenticated
  with check (public.has_role(array['admin','cajero']::public.user_role[]) and cashier_id = auth.uid());
create policy sales_select on public.sales for select to authenticated
  using (public.is_admin() or cashier_id = auth.uid());
create policy sales_admin_update on public.sales for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy sales_admin_delete on public.sales for delete to authenticated using (public.is_admin());

create policy sale_items_insert on public.sale_items for insert to authenticated
  with check (exists (select 1 from public.sales s where s.id = sale_id and s.cashier_id = auth.uid()));
create policy sale_items_select on public.sale_items for select to authenticated
  using (public.is_admin() or exists (select 1 from public.sales s where s.id = sale_id and s.cashier_id = auth.uid()));
create policy sale_items_admin on public.sale_items for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy sale_item_lots_select on public.sale_item_lots for select to authenticated using (public.is_admin());

create policy payments_insert on public.payment_transactions for insert to authenticated
  with check (public.has_role(array['admin','cajero']::public.user_role[]) and received_by = auth.uid());
create policy payments_select on public.payment_transactions for select to authenticated
  using (public.is_admin() or received_by = auth.uid());
create policy payments_admin on public.payment_transactions for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy outbox_admin on public.notification_outbox for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy stock_mov_admin on public.stock_movements for select to authenticated using (public.is_admin());

-- Permisos de ejecución de RPC
revoke all on function public.create_sale(jsonb) from public, anon;
revoke all on function public.void_sale(uuid, text) from public, anon;
revoke all on function public.register_customer_payment(uuid, numeric, public.payment_method, text, text) from public, anon;
revoke all on function public.process_carcass(uuid) from public, anon;
revoke all on function public.expire_lots() from public, anon;
revoke all on function public.enqueue_overdue_reminders() from public, anon;
grant execute on function public.create_sale(jsonb) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.register_customer_payment(uuid, numeric, public.payment_method, text, text) to authenticated;
grant execute on function public.process_carcass(uuid) to authenticated;
grant execute on function public.expire_lots() to authenticated;
grant execute on function public.enqueue_overdue_reminders() to authenticated;

-- ---------------------------------------------------------------------
-- 18. STORAGE: buckets qr-codes (público lectura) y comprobantes (privado)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('qr-codes', 'qr-codes', true, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

drop policy if exists qr_public_read   on storage.objects;
drop policy if exists qr_admin_insert  on storage.objects;
drop policy if exists qr_admin_update  on storage.objects;
drop policy if exists qr_admin_delete  on storage.objects;
drop policy if exists comp_staff_read  on storage.objects;
drop policy if exists comp_staff_write on storage.objects;

create policy qr_public_read  on storage.objects for select using (bucket_id = 'qr-codes');
create policy qr_admin_insert on storage.objects for insert to authenticated with check (bucket_id = 'qr-codes' and public.is_admin());
create policy qr_admin_update on storage.objects for update to authenticated using (bucket_id = 'qr-codes' and public.is_admin());
create policy qr_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'qr-codes' and public.is_admin());
create policy comp_staff_read  on storage.objects for select to authenticated using (bucket_id = 'comprobantes' and public.is_active_staff());
create policy comp_staff_write on storage.objects for insert to authenticated
  with check (bucket_id = 'comprobantes' and public.has_role(array['admin','cajero']::public.user_role[]));

-- ---------------------------------------------------------------------
-- 19. REALTIME (sincronización multiterminal)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['business_settings','products','inventory_lots','customers','sales'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 20. DATOS SEMILLA
-- ---------------------------------------------------------------------
insert into public.categories (name, species, sort_order) values
  ('Res', 'res', 1), ('Cerdo', 'cerdo', 2), ('Pollo', 'pollo', 3),
  ('Embutidos', 'otro', 4), ('Subproductos', 'otro', 5)
on conflict (name) do nothing;

insert into public.cut_types (name, shrink_pct, surcharge_per_kg, sort_order) values
  ('Enchufe', 2, 0, 1),
  ('Molida especial', 4, 1.00, 2),
  ('Fileteado grueso', 3, 0, 3),
  ('Fileteado fino', 5, 0.50, 4),
  ('Picado para guiso', 3, 0, 5)
on conflict (name) do nothing;

insert into public.products (category_id, sku, name, price_per_unit, value_factor, is_commercial_cut, min_stock_kg)
select c.id, v.sku, v.name, v.price, v.factor, v.commercial, v.min_kg
  from (values
    ('Res',          'RES-LOM', 'Lomo fino',         65.00, 3.00, true,  3),
    ('Res',          'RES-BIF', 'Bife / Churrasco',  38.00, 1.80, true,  5),
    ('Res',          'RES-ASA', 'Asado de tira',     30.00, 1.40, true,  5),
    ('Res',          'RES-PEC', 'Pecho',             24.00, 1.00, true,  5),
    ('Res',          'RES-OSO', 'Osobuco',           20.00, 0.80, true,  3),
    ('Res',          'RES-MOL', 'Carne molida',      26.00, 1.00, true,  5),
    ('Cerdo',        'CER-CHU', 'Chuleta de cerdo',  22.00, 1.20, true,  4),
    ('Cerdo',        'CER-PAN', 'Panceta',           20.00, 1.00, true,  3),
    ('Subproductos', 'SUB-GRA', 'Grasa',              4.00, 0.00, false, 0),
    ('Subproductos', 'SUB-HUE', 'Hueso',              3.00, 0.00, false, 0)
  ) as v(cat, sku, name, price, factor, commercial, min_kg)
  join public.categories c on c.name = v.cat
on conflict (sku) do nothing;

-- =====================================================================
-- FIN DEL SCRIPT
-- Opcional (pg_cron): select cron.schedule('expirar-lotes', '5 0 * * *', 'select public.expire_lots()');
--                     select cron.schedule('recordatorios', '0 9 * * *', 'select public.enqueue_overdue_reminders()');
-- =====================================================================
