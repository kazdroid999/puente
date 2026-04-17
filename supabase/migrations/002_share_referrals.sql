-- 002_share_referrals.sql
-- オーナー自発拡散機能 / Share & Referral Tracking

-- ========== オーナーシェア用素材セット ==========
create table if not exists public.share_kits (
  id uuid primary key default gen_random_uuid(),
  saas_id uuid not null references public.saas_projects(id) on delete cascade,
  -- 9:16 / 1:1 / 16:9 の動画 URL（Cowork が R2 / Supabase Storage に生成）
  video_vertical_url text,    -- 1080×1920
  video_square_url text,      -- 1080×1080
  video_landscape_url text,   -- 1920×1080
  -- 静止画 OG セット
  og_default_url text,        -- 1200×630
  og_square_url text,         -- 1080×1080
  -- プリセットコピー（プラットフォーム別）
  copy_x text,
  copy_threads text,
  copy_facebook text,
  copy_linkedin text,
  copy_note text,
  -- 推奨ハッシュタグ
  hashtags text[] default '{}',
  -- 埋め込みウィジェット HTML（iframe）
  embed_html text,
  generated_at timestamptz default now(),
  unique(saas_id)
);

-- ========== シェアクリック計測 ==========
create table if not exists public.share_clicks (
  id bigserial primary key,
  saas_id uuid not null references public.saas_projects(id) on delete cascade,
  owner_company_id uuid references public.companies(id),  -- ref パラメータ由来
  channel text,                                           -- x / threads / facebook / linkedin / note / hatebu / direct
  utm_source text,
  utm_medium text,
  utm_campaign text,
  visitor_id uuid,
  user_agent text,
  referer text,
  created_at timestamptz default now()
);
create index if not exists idx_share_clicks_saas on public.share_clicks(saas_id);
create index if not exists idx_share_clicks_owner on public.share_clicks(owner_company_id);
create index if not exists idx_share_clicks_created on public.share_clicks(created_at);

-- ========== シェア経由のコンバージョン（サブスク獲得） ==========
create table if not exists public.share_conversions (
  id bigserial primary key,
  saas_id uuid not null references public.saas_projects(id),
  owner_company_id uuid references public.companies(id),
  click_id bigint references public.share_clicks(id),
  stripe_subscription_id text,
  amount_jpy integer,
  created_at timestamptz default now()
);
create index if not exists idx_share_conv_owner on public.share_conversions(owner_company_id);

-- ========== オーナー別シェアダッシュボード View ==========
create or replace view public.v_owner_share_stats as
select
  c.id as company_id,
  c.name as company_name,
  s.id as saas_id,
  s.name as saas_name,
  s.slug,
  count(distinct sc.id) as click_count_30d,
  count(distinct conv.id) as conversion_30d,
  coalesce(sum(conv.amount_jpy), 0) as gmv_30d
from public.companies c
join public.saas_projects s on s.company_id = c.id
left join public.share_clicks sc
  on sc.owner_company_id = c.id and sc.saas_id = s.id
  and sc.created_at >= now() - interval '30 days'
left join public.share_conversions conv
  on conv.owner_company_id = c.id and conv.saas_id = s.id
  and conv.created_at >= now() - interval '30 days'
group by c.id, c.name, s.id, s.name, s.slug;

-- ========== シェアインセンティブ Top 10 月次集計 ==========
create or replace view public.v_share_ranking_monthly as
select
  date_trunc('month', conv.created_at) as month,
  c.id as company_id,
  c.name as company_name,
  count(distinct conv.id) as conversions,
  sum(conv.amount_jpy) as gmv,
  rank() over (
    partition by date_trunc('month', conv.created_at)
    order by count(distinct conv.id) desc
  ) as rank
from public.share_conversions conv
join public.companies c on c.id = conv.owner_company_id
group by 1, 2, 3;

-- ========== RLS ==========
alter table public.share_kits enable row level security;
alter table public.share_clicks enable row level security;
alter table public.share_conversions enable row level security;

-- オーナーは自分の SaaS の kit を読める
create policy share_kits_owner_read on public.share_kits
  for select using (
    exists (
      select 1 from public.saas_projects s
      join public.companies c on c.id = s.company_id
      where s.id = share_kits.saas_id and c.owner_user_id = auth.uid()
    )
  );

-- クリック・コンバージョンは自社オーナーのみ参照可
create policy share_clicks_owner_read on public.share_clicks
  for select using (
    owner_company_id in (
      select id from public.companies where owner_user_id = auth.uid()
    )
  );
create policy share_conv_owner_read on public.share_conversions
  for select using (
    owner_company_id in (
      select id from public.companies where owner_user_id = auth.uid()
    )
  );

comment on table public.share_kits is 'SaaS 公開時に Cowork が自動生成するシェア素材セット';
comment on table public.share_clicks is 'オーナー経由のシェアリンククリック計測';
comment on table public.share_conversions is 'シェア経由でのサブスク獲得コンバージョン';
