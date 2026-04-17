// Punete Micro SaaS Store — Workers API (Hono)
// https://api.puente-saas.com/*

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './types';
import { sb, getUserId, isSuperAdmin } from './supabase';
import {
  createConnectAccount,
  createPlanPrices,
  createCheckoutSession,
  createInitialFeeCheckout,
  handleWebhook,
} from './stripe';
import { issueInitialDiscount } from './coupons';
import { analyzeBrief } from './ai-analyzer';
import { runPromoQueue } from './promo';

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

app.use('*', logger());
app.use('*', secureHeaders({
  strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"],
    connectSrc: ["'self'", "https://rzrewjgtgazdpstnkhbt.supabase.co", "https://api.puente-saas.com"],
    frameAncestors: ["'none'"],
  },
  xFrameOptions: 'DENY',
  permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
}));
const ALLOWED_ORIGINS = [
  'https://puente-saas.com',
  'https://www.puente-saas.com',
  'https://apps.puente-saas.com',
  'https://dashboard.puente-saas.com',
  'https://admin.puente-saas.com',
];
app.use('/api/*', cors({
  origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : '',
  credentials: true,
  allowHeaders: ['authorization', 'content-type', 'stripe-signature'],
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
}));
// Public checkout も同じ CORS (credentials 不要だが origin 制限は必要)
app.use('/public/*', cors({
  origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : '',
  allowHeaders: ['content-type'],
  allowMethods: ['POST', 'OPTIONS'],
}));

// ---------- Health ----------
app.get('/', (c) => c.json({ service: 'puente-store-api', env: c.env.ENVIRONMENT }));

// ---------- Webhook (署名検証は stripe.ts 側) ----------
app.post('/stripe/webhook', async (c) => handleWebhook(c.env, c.req.raw));

// ---------- auth middleware ----------
const auth = async (c: any, next: any) => {
  const userId = await getUserId(c.env, c.req.header('authorization') ?? null);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', userId);
  await next();
};

// ========== Companies ==========
app.post('/api/companies', auth, async (c) => {
  const uid = c.get('userId');
  const body = await c.req.json();
  const { data, error } = await sb(c.env)
    .from('companies')
    .insert({
      owner_id: uid,
      legal_name: body.legal_name,
      representative_name: body.representative_name,
      corporate_number: body.corporate_number ?? null,
      invoice_registration_number: body.invoice_registration_number ?? null,
      is_invoice_registered: !!body.invoice_registration_number,
      address: body.address ?? null,
      phone: body.phone ?? null,
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  // 80%OFF クーポンを初期発行
  const coupon = await issueInitialDiscount(c.env, data.id);
  return c.json({ company: data, coupon });
});

app.patch('/api/companies/:id/invoice', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { invoice_registration_number } = await c.req.json();
  // T + 13桁 の簡易バリデーション
  if (invoice_registration_number && !/^T\d{13}$/.test(invoice_registration_number)) {
    return c.json({ error: 'invalid invoice registration number format (T + 13 digits)' }, 400);
  }
  const { data, error } = await sb(c.env)
    .from('companies')
    .update({
      invoice_registration_number,
      is_invoice_registered: !!invoice_registration_number,
    })
    .eq('id', id)
    .eq('owner_id', uid)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ company: data });
});

// ========== Stripe Connect ==========
app.post('/api/companies/:id/connect', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { data: company } = await sb(c.env)
    .from('companies')
    .select('id,owner_id')
    .eq('id', id)
    .eq('owner_id', uid)
    .single();
  if (!company) return c.json({ error: 'not found' }, 404);
  const { data: profile } = await sb(c.env).from('profiles').select('email').eq('id', uid).single();
  const result = await createConnectAccount(c.env, id, profile?.email ?? '');
  return c.json(result);
});

// ========== 初期費用 Checkout ==========
app.post('/api/companies/:id/initial-fee-checkout', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { coupon_code } = await c.req.json();

  // 1社1回制約
  const { data: company } = await sb(c.env)
    .from('companies')
    .select('id,first_launch_at')
    .eq('id', id)
    .eq('owner_id', uid)
    .single();
  if (!company) return c.json({ error: 'not found' }, 404);
  if (company.first_launch_at) return c.json({ error: '初期費用は既に支払い済みです' }, 409);

  let amount = 330000; // 30万 + 税
  if (coupon_code) {
    const { data: coupon } = await sb(c.env)
      .from('coupons')
      .select('discount_percent,used_at')
      .eq('company_id', id)
      .eq('code', coupon_code)
      .single();
    if (coupon && !coupon.used_at) amount = Math.round(amount * (1 - coupon.discount_percent / 100));
  }

  const result = await createInitialFeeCheckout(c.env, {
    companyId: id,
    amountJpy: amount,
    successUrl: `${c.env.APP_ORIGIN}/dashboard?initial_fee=success`,
    cancelUrl: `${c.env.APP_ORIGIN}/dashboard?initial_fee=cancel`,
  });
  return c.json(result);
});

// ========== SaaS Projects ==========
app.post('/api/saas', auth, async (c) => {
  const uid = c.get('userId');
  const body = await c.req.json();
  const { data: company } = await sb(c.env)
    .from('companies')
    .select('id')
    .eq('owner_id', uid)
    .eq('id', body.company_id)
    .single();
  if (!company) return c.json({ error: 'company not found' }, 404);

  const { data, error } = await sb(c.env)
    .from('saas_projects')
    .insert({
      company_id: body.company_id,
      slug: body.slug,
      name: body.name,
      name_en: body.name_en ?? null,
      tagline: body.tagline ?? null,
      category: body.category ?? 'business',
      tags: body.tags ?? [],
      brief: body.brief ?? {},
      status: 'draft',
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ saas: data });
});

app.post('/api/saas/:id/analyze', auth, async (c) => {
  const id = c.req.param('id');
  const { data: saas } = await sb(c.env)
    .from('saas_projects')
    .select('id,brief')
    .eq('id', id)
    .single();
  if (!saas) return c.json({ error: 'not found' }, 404);
  const plan = await analyzeBrief(c.env, id, saas.brief);
  return c.json({ plan });
});

app.post('/api/saas/:id/approve', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const { data, error } = await sb(c.env)
    .from('saas_projects')
    .update({ status: 'in_development', approved_by: uid, approved_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ saas: data });
});

app.post('/api/saas/:id/publish', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const { data: saas } = await sb(c.env).from('saas_projects').select('name').eq('id', id).single();
  if (!saas) return c.json({ error: 'not found' }, 404);
  // Stripe Product / Price を生成（ユーザーがまだ作っていなければ）
  const prices = await createPlanPrices(c.env, id, saas.name);
  // saas_plans テーブルに価格ID をフラッシュ
  for (const p of prices.plans) {
    const unit = { Free: 0, Basic: 980, Standard: 1980, Pro: 2980 }[p.name] ?? 0;
    await sb(c.env).from('saas_plans').upsert(
      { saas_id: id, name: p.name, price_jpy: unit, stripe_price_id: p.price_id },
      { onConflict: 'saas_id,name' },
    );
  }
  const { data, error } = await sb(c.env)
    .from('saas_projects')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ saas: data, prices });
});

// ========== エンドユーザー課金 Checkout ==========
app.post('/public/saas/:id/checkout', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  try {
    const result = await createCheckoutSession(c.env, {
      saasId: id,
      planName: body.plan_name,
      customerEmail: body.email,
      successUrl: body.success_url,
      cancelUrl: body.cancel_url,
    });
    if (result?.error) return c.json({ error: result.error }, result.status ?? 400);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

// ========== 売上・Payout ==========
app.get('/api/companies/:id/revenue', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { data: company } = await sb(c.env)
    .from('companies')
    .select('id')
    .eq('id', id)
    .eq('owner_id', uid)
    .maybeSingle();
  if (!company && !(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const { data: monthly } = await sb(c.env)
    .from('v_monthly_revenue')
    .select('*')
    .eq('company_id', id)
    .order('month', { ascending: false })
    .limit(24);
  const { data: balance } = await sb(c.env)
    .from('v_company_connect_balance')
    .select('*')
    .eq('company_id', id)
    .single();
  return c.json({ monthly, balance });
});

app.post('/api/companies/:id/payouts/request', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { data: company } = await sb(c.env)
    .from('companies')
    .select('id')
    .eq('id', id)
    .eq('owner_id', uid)
    .single();
  if (!company) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json();
  const { data, error } = await sb(c.env)
    .from('payouts')
    .insert({
      company_id: id,
      amount_jpy: body.amount_jpy,
      status: 'requested',
      requested_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ payout: data });
});

// ========== Super Admin ==========
app.get('/api/admin/overview', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const s = sb(c.env);
  const [{ count: companies }, { count: saas }, { count: subs }, { data: monthly }] = await Promise.all([
    s.from('companies').select('*', { count: 'exact', head: true }),
    s.from('saas_projects').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    s.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    s.from('v_monthly_revenue').select('*').order('month', { ascending: false }).limit(12),
  ]);
  return c.json({ companies, saas_published: saas, active_subs: subs, monthly });
});

// ========== Promo cron (super_admin or scheduled event only) ==========
app.post('/internal/promo/run', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const result = await runPromoQueue(c.env);
  return c.json(result);
});

// ---------- fallback ----------
app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env) {
    await runPromoQueue(env);
  },
};
