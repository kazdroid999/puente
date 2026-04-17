-- Punete Micro SaaS Store — 初期スキーマ
-- 2026-04-15 / PUENTE Inc.
-- 前提: Supabase Postgres 15+, pgcrypto, uuid-ossp

create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;

-- ========== 1. users (auth.users の拡張プロファイル) ==========
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  locale text not null default 'ja' check (locale in ('ja','en')),
  role text not null default 'user' check (role in ('user','super_admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== 2. companies (利用者の法人情報) ==========
create table public.companies (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  legal_name text not null,
  representative_name text not null,
  corporate_number text,                       -- 法人番号 (任意)
  invoice_registration_number text,            -- 適格請求書発行事業者登録番号 T+13桁 (Phase 3 追加)
  is_invoice_registered boolean not null default false,
  address text,
  phone text,
  stripe_connect_account_id text unique,       -- acct_xxx
  stripe_connect_status text not null default 'pending' check (stripe_connect_status in ('pending','onboarding','active','restricted','rejected')),
  stripe_charges_enabled boolean not null default false,
  stripe_payouts_enabled boolean not null default false,
  first_launch_at timestamptz,                 -- 初回ローンチ日(初期費用はこの1回のみ)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index companies_corporate_number_key on public.companies(corporate_number) where corporate_number is not null;
create index companies_owner_id_idx on public.companies(owner_id);

-- ========== 3. saas_projects (Micro SaaS 企画〜運営) ==========
create type saas_status as enum (
  'draft','ai_analyzing','pending_approval','approved','in_development',
  'ready_for_review','preview','published','paused','archived','rejected'
);
create type saas_category as enum ('business','learning','entertainment','infra');

create table public.saas_projects (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  slug text not null,
  name text not null,
  name_en text,
  tagline text,
  tagline_en text,
  short_description text,
  short_description_en text,
  long_description text,
  long_description_en text,
  category saas_category not null default 'business',
  tags text[] not null default '{}',
  status saas_status not null default 'draft',
  featured boolean not null default false,
  editorial_pick boolean not null default false,
  seasonal_tag text,                           -- 'spring_2026' など
  brief jsonb not null default '{}'::jsonb,    -- ユーザー投稿原文
  ai_plan jsonb,                               -- AI 生成 事業計画 + BEP + 技術スタック
  repo_url text,
  preview_url text,
  public_url text,                             -- /apps/{category}/{slug}/
  og_image_url text,
  square_image_url text,
  favicon_url text,
  stripe_product_id text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);
create index saas_projects_company_idx on public.saas_projects(company_id);
create index saas_projects_status_idx on public.saas_projects(status);
create index saas_projects_category_idx on public.saas_projects(category);
create index saas_projects_featured_idx on public.saas_projects(featured) where featured = true;

-- ========== 4. saas_plans (各SaaSのサブスクプラン) ==========
create table public.saas_plans (
  id uuid primary key default uuid_generate_v4(),
  saas_id uuid not null references public.saas_projects(id) on delete cascade,
  name text not null check (name in ('Free','Basic','Standard','Pro')),
  price_jpy integer not null,                  -- 税込
  stripe_price_id text,
  features jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (saas_id, name)
);

-- ========== 5. subscriptions (エンドユーザーのサブスク) ==========
create table public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  saas_id uuid not null references public.saas_projects(id) on delete cascade,
  end_user_email text not null,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  plan_name text not null,
  status text not null check (status in ('trialing','active','past_due','canceled','incomplete','incomplete_expired','unpaid')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);
create index subscriptions_saas_idx on public.subscriptions(saas_id);
create index subscriptions_status_idx on public.subscriptions(status);

-- ========== 6. revenue_events (売上分配イベント - Stripe Webhook 経由で記録) ==========
create table public.revenue_events (
  id uuid primary key default uuid_generate_v4(),
  saas_id uuid not null references public.saas_projects(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  stripe_payment_intent_id text unique,
  stripe_charge_id text,
  gross_amount_jpy integer not null,           -- GMV (税込)
  puente_revenue_jpy integer not null,         -- 70% (プエンテ売上)
  user_revenue_jpy integer not null,           -- 30% (ユーザー売上)
  application_fee_jpy integer not null,        -- = puente_revenue_jpy
  stripe_fee_jpy integer,                      -- Stripe決済手数料 (参考)
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index revenue_events_saas_idx on public.revenue_events(saas_id);
create index revenue_events_company_idx on public.revenue_events(company_id);
create index revenue_events_occurred_idx on public.revenue_events(occurred_at);

-- ========== 7. payouts (ユーザーへの振込記録) ==========
create table public.payouts (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  stripe_payout_id text unique,
  amount_jpy integer not null,                 -- 税込
  status text not null check (status in ('pending','requested','paid','failed','canceled')),
  requested_at timestamptz,                    -- ユーザーが出金指示
  paid_at timestamptz,                         -- 実振込日
  bank_last4 text,
  created_at timestamptz not null default now()
);
create index payouts_company_idx on public.payouts(company_id);

-- ========== 8. coupons (80%OFF 等) ==========
create table public.coupons (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text unique not null,                   -- ダッシュボード表示用
  stripe_coupon_id text,
  stripe_promotion_code text,
  discount_percent integer not null,           -- 80
  used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index coupons_one_per_company on public.coupons(company_id) where discount_percent = 80;

-- ========== 9. initial_fee_invoices (初期費用請求) ==========
create table public.initial_fee_invoices (
  id uuid primary key default uuid_generate_v4(),
  company_id uuid not null references public.companies(id) on delete cascade,
  saas_id uuid references public.saas_projects(id),
  amount_jpy integer not null,                 -- 1,100,000 or 220,000
  coupon_id uuid references public.coupons(id),
  stripe_payment_intent_id text,
  status text not null check (status in ('pending','paid','failed','refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
-- 1社1回制約は application層で制御 (first_launch_at を条件に判定)

-- ========== 10. view_history (パーソナライズ用) ==========
create table public.view_history (
  id bigserial primary key,
  visitor_id text not null,                    -- cookie ID (uuid)
  saas_id uuid references public.saas_projects(id) on delete cascade,
  category saas_category,
  viewed_at timestamptz not null default now()
);
create index view_history_visitor_idx on public.view_history(visitor_id);
create index view_history_viewed_idx on public.view_history(viewed_at desc);

-- ========== 11. editorial_collections (編集部セレクション / 季節特集) ==========
create table public.editorial_collections (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,
  title text not null,
  title_en text,
  description text,
  description_en text,
  hero_image_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.editorial_items (
  collection_id uuid references public.editorial_collections(id) on delete cascade,
  saas_id uuid references public.saas_projects(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (collection_id, saas_id)
);

-- ========== 12. promo_posts (PR/SNS 自動投稿キュー) ==========
create table public.promo_posts (
  id uuid primary key default uuid_generate_v4(),
  saas_id uuid not null references public.saas_projects(id) on delete cascade,
  channel text not null check (channel in ('prtimes','wix_blog','x','instagram','facebook','tiktok','youtube_short')),
  payload jsonb not null,
  scheduled_at timestamptz not null default now(),
  posted_at timestamptz,
  external_url text,
  status text not null default 'queued' check (status in ('queued','posting','posted','failed')),
  error text,
  created_at timestamptz not null default now()
);
create index promo_posts_status_idx on public.promo_posts(status);

-- ========== 13. audit_log ==========
create table public.audit_log (
  id bigserial primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  target_type text,
  target_id uuid,
  diff jsonb,
  created_at timestamptz not null default now()
);

-- ========== ビュー: 集計 (Super Admin 用) ==========
create view public.v_monthly_revenue as
select
  date_trunc('month', occurred_at) as month,
  saas_id,
  company_id,
  sum(gross_amount_jpy) as gmv,
  sum(puente_revenue_jpy) as puente_revenue,
  sum(user_revenue_jpy) as user_revenue,
  count(*) as txn_count
from public.revenue_events
group by 1,2,3;

create view public.v_company_connect_balance as
select
  c.id as company_id,
  c.legal_name,
  coalesce(sum(re.user_revenue_jpy), 0) - coalesce(sum(case when p.status = 'paid' then p.amount_jpy else 0 end), 0) as available_balance_jpy
from public.companies c
left join public.revenue_events re on re.company_id = c.id
left join public.payouts p on p.company_id = c.id
group by c.id, c.legal_name;

-- ========== updated_at 自動更新 ==========
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_profiles_updated before update on public.profiles for each row execute function set_updated_at();
create trigger trg_companies_updated before update on public.companies for each row execute function set_updated_at();
create trigger trg_saas_projects_updated before update on public.saas_projects for each row execute function set_updated_at();

-- ========== RLS ==========
alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.saas_projects enable row level security;
alter table public.saas_plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.revenue_events enable row level security;
alter table public.payouts enable row level security;
alter table public.coupons enable row level security;
alter table public.initial_fee_invoices enable row level security;
alter table public.editorial_collections enable row level security;
alter table public.editorial_items enable row level security;

-- super_admin は常に全閲覧
create policy super_admin_all_profiles on public.profiles for all using (
  exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);
create policy self_profile on public.profiles for select using (id = auth.uid());
create policy self_profile_update on public.profiles for update using (id = auth.uid());

create policy owner_companies on public.companies for all using (
  owner_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);

create policy owner_saas_projects on public.saas_projects for all using (
  exists (select 1 from public.companies c where c.id = saas_projects.company_id and c.owner_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);
-- 公開済みSaaSは匿名でも閲覧可
create policy public_saas_read on public.saas_projects for select using (
  status = 'published'
);

create policy owner_revenue_events on public.revenue_events for select using (
  exists (select 1 from public.companies c where c.id = revenue_events.company_id and c.owner_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);

create policy owner_payouts on public.payouts for select using (
  exists (select 1 from public.companies c where c.id = payouts.company_id and c.owner_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);

create policy owner_coupons on public.coupons for select using (
  exists (select 1 from public.companies c where c.id = coupons.company_id and c.owner_id = auth.uid())
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'super_admin')
);

create policy public_editorial_read on public.editorial_collections for select using (true);
create policy public_editorial_items_read on public.editorial_items for select using (true);

-- ========== seed: 初期 Super Admin & 編集部セレクション ==========
insert into public.editorial_collections (slug, title, title_en, description, description_en, sort_order)
values
  ('spring-2026', '春の新生活特集', 'Spring 2026 Selection', '新年度の業務効率化に効く Micro SaaS 厳選', 'Hand-picked Micro SaaS for the new fiscal year', 1),
  ('founders-pick', '編集部セレクション', 'Editorial Picks', 'Puente 編集部が選ぶ今月の注目アプリ', 'This month''s featured apps by Puente Editorial', 2);

comment on table public.revenue_events is '売上分配イベント（売上分配方式・ロイヤリティ支払いではない）';
comment on column public.revenue_events.puente_revenue_jpy is 'プエンテ自身の売上計上分（70%）';
comment on column public.revenue_events.user_revenue_jpy is 'ユーザー自身の売上計上分（30%）';
comment on column public.companies.invoice_registration_number is '適格請求書発行事業者登録番号 T+13桁（売上分配方式のため、プエンテへの発行は不要だが、ユーザー側のインボイス制度対応管理用）';
