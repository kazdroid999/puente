// Punete Micro SaaS Store — Workers API (Hono)
// https://api.puente-saas.com/*

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './types';
import { sb, sbAdmin, sbUser, getUserId, isSuperAdmin } from './supabase';
import {
  createConnectAccount,
  refreshConnectStatus,
  createPlanPrices,
  createCheckoutSession,
  createInitialFeeCheckout,
  handleWebhook,
  stripeClient,
} from './stripe';
import { issueInitialDiscount, reconcileAllFounderCoupons } from './coupons';
import { collectDailyKpi } from './performance-collector';
import { analyzeBrief } from './ai-analyzer';
import { runPromoQueue } from './promo';
import { chatWithMaria } from './maria-chat';

const app = new Hono<{ Bindings: Env; Variables: { userId: string; authHeader: string } }>();

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
  crossOriginResourcePolicy: 'cross-origin',
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
  origin: (origin) => {
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    // Allow all *.puente-saas.com subdomains (for Micro SaaS apps)
    if (origin && /^https:\/\/[a-z0-9-]+\.puente-saas\.com$/.test(origin)) return origin;
    // Allow Pages preview URLs
    if (origin && /^https:\/\/[a-z0-9-]+\.puente-apps\.pages\.dev$/.test(origin)) return origin;
    return '';
  },
  credentials: true,
  allowHeaders: ['authorization', 'content-type', 'stripe-signature'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use('/public/*', cors({
  origin: (origin) => {
    if (ALLOWED_ORIGINS.includes(origin)) return origin;
    if (origin && /^https:\/\/[a-z0-9-]+\.puente-saas\.com$/.test(origin)) return origin;
    return '';
  },
  allowHeaders: ['content-type', 'authorization'],
  allowMethods: ['POST', 'OPTIONS'],
}));

// ---------- Health ----------
app.get('/', (c) => c.json({ service: 'puente-store-api', env: c.env.ENVIRONMENT }));

// ---------- Screenshot proxy (public, cached 24h) ----------
const ALLOWED_SCREENSHOT_DOMAINS = [
  'puentemcp.com', 'ma-portal.net', 'hojokin-ai.org',
  'aiceosimulator.com', 'ken-ringo.com', 'alive-casino.games',
];
app.get('/api/screenshot', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'url param required' }, 400);
  try {
    const parsed = new URL(url);
    if (!ALLOWED_SCREENSHOT_DOMAINS.includes(parsed.hostname)) {
      return c.json({ error: 'domain not allowed' }, 403);
    }
  } catch { return c.json({ error: 'invalid url' }, 400); }

  const thumbUrl = `https://image.thum.io/get/width/640/crop/400/${url}`;

  // Check Workers Cache API first
  const cacheKey = new Request(c.req.url);
  const cache = caches.default;
  let cached = await cache.match(cacheKey);
  if (cached) return cached;

  const resp = await fetch(thumbUrl, {
    headers: { 'User-Agent': 'PuenteBot/1.0' },
  });
  if (!resp.ok) return c.json({ error: 'upstream error' }, 502);

  const img = await resp.arrayBuffer();
  const ct = resp.headers.get('content-type') || 'image/png';
  const response = new Response(img, {
    headers: {
      'Content-Type': ct,
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
  // Store in cache for next requests
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
});

// ---------- Webhook (署名検証は stripe.ts 側) ----------
app.post('/stripe/webhook', async (c) => handleWebhook(c.env, c.req.raw));

// ---------- Maria AI Chat (auth optional - 匿名でも会話可能) ----------
// POST /public/maria/chat
//   body: { message: string, session_id?: string }
//   header: Authorization: Bearer <jwt>  (任意。あればログインユーザー、なければ匿名)
// 匿名 5 msg/24h/IP, ログイン 30 msg/24h/user
app.post('/public/maria/chat', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const message = (body?.message ?? '').toString();
  const sessionId = (body?.session_id ?? null) as string | null;

  // 認証ヘッダがあればユーザー特定
  let userId: string | null = null;
  const authHeader = c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    try {
      const { data } = await sb(c.env).auth.getUser(token);
      userId = data?.user?.id ?? null;
    } catch {}
  }

  const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || null;

  const result = await chatWithMaria(c.env, { message, userId, sessionId, clientIp });
  if ('error' in result) {
    return c.json(result, result.code === 'rate_limit_exceeded' ? 429 : 400);
  }
  return c.json(result);
});

// ---------- Admin: force re-analyze (temporary, auth by Stripe secret) ----------
app.post('/admin/reanalyze/:id', async (c) => {
  const key = c.req.header('x-admin-key');
  if (key !== c.env.STRIPE_SECRET_KEY) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const { data: saas } = await sbAdmin(c.env).from('saas_projects').select('id,brief').eq('id', id).single();
  if (!saas) return c.json({ error: 'not found' }, 404);
  const { analyzeBrief } = await import('./ai-analyzer');

  const env = c.env;
  const analysisPromise = analyzeBrief(env, id, saas.brief).catch((err: Error) => {
    console.error('Admin re-analysis failed:', err.message, err.stack);
    sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', id);
  });

  try {
    const ctx = c.executionCtx;
    if (ctx && typeof (ctx as any).waitUntil === 'function') {
      (ctx as any).waitUntil(analysisPromise);
    }
  } catch (e) {
    console.error('waitUntil setup failed:', e);
  }

  return c.json({ message: 'AI分析を再開しました', saas_id: id });
});

// ---------- Admin: force auto-dev pipeline (auth by Stripe secret) ----------
app.post('/admin/auto-dev/:id', async (c) => {
  const key = c.req.header('x-admin-key');
  if (key !== c.env.STRIPE_SECRET_KEY) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const { data: saas } = await sbAdmin(c.env)
    .from('saas_projects')
    .select('id,brief,ai_plan,company_id,companies(owner_id)')
    .eq('id', id)
    .single();
  if (!saas) return c.json({ error: 'not found' }, 404);
  const ownerId = (saas as any).companies?.owner_id || saas.company_id;
  const { runAutoDev } = await import('./auto-dev');
  const result = await runAutoDev(c.env, id, saas.brief, saas.ai_plan, ownerId);
  return c.json({ result });
});

// ---------- auth middleware ----------
const auth = async (c: any, next: any) => {
  const authHeader = c.req.header('authorization') ?? null;
  const userId = await getUserId(c.env, authHeader);
  if (!userId) return c.json({ error: 'unauthorized' }, 401);
  c.set('userId', userId);
  c.set('authHeader', authHeader);
  await next();
};
// Helper: get user-authenticated Supabase client from context
const sbu = (c: any) => sbUser(c.env, c.get('authHeader'));

// ========== Me (profile) ==========
app.get('/api/me', auth, async (c) => {
  const uid = c.get('userId');
  const { data } = await sbu(c).from('profiles').select('id,role,display_name,avatar_url').eq('id', uid).single();
  return c.json(data ?? { id: uid, role: 'user' });
});

// ========== Companies ==========
app.post('/api/companies', auth, async (c) => {
  const uid = c.get('userId');
  const body = await c.req.json();
  const { data, error } = await sbu(c)
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
  const coupon = await issueInitialDiscount(c.env, data.id);
  return c.json({ company: data, coupon });
});

app.patch('/api/companies/:id/invoice', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { invoice_registration_number } = await c.req.json();
  if (invoice_registration_number && !/^T\d{13}$/.test(invoice_registration_number)) {
    return c.json({ error: 'invalid invoice registration number format (T + 13 digits)' }, 400);
  }
  const { data, error } = await sbu(c)
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
  // owner 確認は admin client で（user JWT の sb() が落ちる場合に対する保険）
  const { data: company } = await sbAdmin(c.env)
    .from('companies')
    .select('id,owner_id')
    .eq('id', id)
    .eq('owner_id', uid)
    .maybeSingle();
  if (!company) return c.json({ error: 'not found or not owner' }, 404);
  const { data: profile } = await sbAdmin(c.env).from('profiles').select('email').eq('id', uid).maybeSingle();
  const result = await createConnectAccount(c.env, id, profile?.email ?? '');
  return c.json(result);
});

// Stripe Connect 状態を Stripe API から直接 pull して companies へ即時反映。
// /dashboard/connect/return 着地時にフロントから叩く想定。Webhook 遅延の影響を受けない。
app.post('/api/companies/:id/connect/refresh', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { data: company } = await sbAdmin(c.env)
    .from('companies')
    .select('id,owner_id')
    .eq('id', id)
    .eq('owner_id', uid)
    .maybeSingle();
  if (!company) return c.json({ error: 'not found or not owner' }, 404);
  try {
    const result = await refreshConnectStatus(c.env, id);
    if ('error' in result) return c.json({ error: result.error }, result.status as 404);
    return c.json(result);
  } catch (e: any) {
    console.error('[connect/refresh] failed:', e?.message ?? e);
    return c.json({ error: e?.message || 'refresh failed' }, 500);
  }
});

// ========== 初期費用 Checkout ==========
app.post('/api/companies/:id/initial-fee-checkout', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const { coupon_code } = await c.req.json();
  const { data: company } = await sbu(c)
    .from('companies')
    .select('id,first_launch_at')
    .eq('id', id)
    .eq('owner_id', uid)
    .single();
  if (!company) return c.json({ error: 'not found' }, 404);
  if (company.first_launch_at) return c.json({ error: '初期費用は既に支払い済みです' }, 409);
  let amount = 330000;
  if (coupon_code) {
    const { data: coupon } = await sbu(c)
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
// 企画投稿 → 自動でAI分析トリガー
app.post('/api/saas', auth, async (c) => {
  const uid = c.get('userId');
  const body = await c.req.json();
  const db = sbu(c);
  const admin = sbAdmin(c.env);

  // company_id がない場合は自動作成（LP簡易フロー用）
  let companyId = body.company_id;
  if (!companyId) {
    // ユーザーの既存 company を探すか新規作成
    const { data: existing } = await db
      .from('companies')
      .select('id')
      .eq('owner_id', uid)
      .limit(1)
      .maybeSingle();
    if (existing) {
      companyId = existing.id;
    } else {
      const { data: profile } = await db.from('profiles').select('email,display_name').eq('id', uid).single();
      const { data: newCompany, error: compErr } = await db
        .from('companies')
        .insert({
          owner_id: uid,
          legal_name: profile?.display_name || profile?.email || 'N/A',
          representative_name: profile?.display_name || 'N/A',
        })
        .select()
        .single();
      if (compErr) return c.json({ error: compErr.message }, 400);
      companyId = newCompany.id;
    }
  } else {
    const { data: company } = await db
      .from('companies')
      .select('id')
      .eq('owner_id', uid)
      .eq('id', companyId)
      .single();
    if (!company) return c.json({ error: 'company not found' }, 404);
  }

  // ★ Stripe Connect onboarding が完了していないと投稿不可。
  //   マルチテナント設計の根幹: ユーザーがエンドユーザーから 30% 売上を受け取る
  //   口座を持っていなければ、SaaS を投稿しても課金フローを動かせないため。
  //   (memory: project_revenue_share.md で明示)
  const { data: companyConnect } = await admin
    .from('companies')
    .select('id,stripe_connect_account_id,stripe_charges_enabled')
    .eq('id', companyId)
    .maybeSingle();
  if (!companyConnect?.stripe_charges_enabled) {
    return c.json({
      error: 'SaaS を投稿する前に Stripe Connect 連携（収益受け取り設定）を完了してください。ダッシュボードの「Stripe Connect 連携」カードから設定できます。',
      code: 'connect_required',
      onboarding_required: true,
      company_id: companyId,
    }, 400);
  }

  const slug = (body.name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60) + '-' + Date.now().toString(36);

  const brief = {
    name: body.name,
    category: body.category || 'business',
    overview: body.overview || body.summary || '',
    target_users: body.target_users || '',
    features: Array.isArray(body.features) ? body.features : (body.desired_features || '').split('\n').filter(Boolean),
  };

  const { data, error } = await db
    .from('saas_projects')
    .insert({
      company_id: companyId,
      slug,
      name: body.name,
      tagline: body.tagline ?? null,
      category: body.category ?? 'business',
      tags: body.tags ?? [],
      brief,
      status: 'draft',
    })
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);

  // ★ 自動でAI分析をバックグラウンドトリガー（非同期）
  const saasId = data.id;
  const env = c.env;
  const analysisPromise = analyzeBrief(env, saasId, brief).catch((err: Error) => {
    console.error('AI analysis failed:', err.message, err.stack);
    sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', saasId);
  });

  // Use Hono executionCtx.waitUntil if available, otherwise fall back to fire-and-forget
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof (ctx as any).waitUntil === 'function') {
      (ctx as any).waitUntil(analysisPromise);
    } else {
      // Fallback: await inline (may hit timeout for long analyses, but at least it runs)
      analysisPromise; // fire-and-forget
    }
  } catch (e) {
    console.error('waitUntil setup failed:', e);
  }

  return c.json({ saas: data, message: 'AI分析を開始しました' });
});

// 手動AI分析トリガー（リトライ用） — waitUntil で非同期実行
app.post('/api/saas/:id/analyze', auth, async (c) => {
  const id = c.req.param('id');
  const { data: saas } = await sbu(c)
    .from('saas_projects')
    .select('id,brief')
    .eq('id', id)
    .single();
  if (!saas) return c.json({ error: 'not found' }, 404);

  const env = c.env;
  const analysisPromise = analyzeBrief(env, id, saas.brief).catch((err: Error) => {
    console.error('AI re-analysis failed:', err.message, err.stack);
    sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', id);
  });

  try {
    const ctx = c.executionCtx;
    if (ctx && typeof (ctx as any).waitUntil === 'function') {
      (ctx as any).waitUntil(analysisPromise);
    }
  } catch (e) {
    console.error('waitUntil setup failed:', e);
  }

  return c.json({ message: 'AI分析を再開しました', saas_id: id });
});

// ユーザーの全プロジェクト一覧
app.get('/api/saas', auth, async (c) => {
  const uid = c.get('userId');
  const { data, error } = await sbu(c)
    .from('saas_projects')
    .select('id,name,slug,category,status,ai_plan,brief,created_at,updated_at,preview_url,public_url,dev_phase,dev_progress,dev_started_at')
    .order('created_at', { ascending: false });

  if (error) return c.json({ error: error.message }, 400);

  // RLSで owner のプロジェクトだけ返る（super_adminなら全件）
  return c.json({ projects: data });
});

// プロジェクト詳細
app.get('/api/saas/:id', auth, async (c) => {
  const id = c.req.param('id');
  const { data, error } = await sbu(c)
    .from('saas_projects')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) return c.json({ error: 'not found' }, 404);
  return c.json({ saas: data });
});

// 管理者: ステータス変更（手動オーバーライド用）
app.patch('/api/saas/:id/status', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const { status } = await c.req.json();
  const { data, error } = await sbu(c)
    .from('saas_projects')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ saas: data });
});

// オーナー公開承認: preview のプロジェクトを published に遷移させる
// saas_apps.is_published も true にしてLP/apps一覧に表示される。
app.post('/api/saas/:id/publish', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');

  // オーナー確認 (RLS が owner_id で守るが明示的にもチェック)
  const db = sbu(c);
  const { data: project, error: pErr } = await db
    .from('saas_projects')
    .select('id,status,slug,category,name,company_id')
    .eq('id', id)
    .single();
  if (pErr || !project) return c.json({ error: 'not found' }, 404);

  // オーナー or super_admin のみ
  if (!(await isSuperAdmin(c.env, uid))) {
    const { data: company } = await db.from('companies').select('id').eq('id', project.company_id).eq('owner_id', uid).maybeSingle();
    if (!company) return c.json({ error: 'forbidden' }, 403);
  }

  // status が preview または ready_for_review の時のみ公開可
  if (!['preview', 'ready_for_review'].includes(project.status)) {
    return c.json({ error: `このプロジェクトはプレビュー段階ではありません (status=${project.status})` }, 400);
  }

  const admin = sbAdmin(c.env);

  // ★ マルチテナント (is_official=false) は Stripe Connect onboarding 必須。
  // owner の company.stripe_charges_enabled が true でないと公開させない。
  // (公式 SaaS = Puente 自社運営 = Connect 不要)
  const { data: appCheck } = await admin
    .from('saas_apps')
    .select('is_official,owner_id')
    .eq('slug', project.slug)
    .single();
  if (appCheck && appCheck.is_official !== true) {
    const ownerId = appCheck.owner_id;
    if (!ownerId) {
      return c.json({ error: 'owner_id missing on saas_apps. データ不整合。', code: 'no_owner' }, 500);
    }
    const { data: ownerCompany } = await admin
      .from('companies')
      .select('id,stripe_connect_account_id,stripe_charges_enabled')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ownerCompany?.stripe_connect_account_id || !ownerCompany?.stripe_charges_enabled) {
      return c.json({
        error: 'Stripe 連携（収益受け取り設定）が未完了のため、公開できません。ダッシュボードから Stripe Connect の設定を完了してください。',
        code: 'connect_not_ready',
        onboarding_required: true,
        company_id: ownerCompany?.id ?? null,
      }, 400);
    }
  }

  // saas_projects.status を published に、saas_apps.is_published を true に
  const { error: pUpdErr } = await admin.from('saas_projects').update({ status: 'published' }).eq('id', id);
  if (pUpdErr) return c.json({ error: 'project update failed: ' + pUpdErr.message }, 500);

  const { error: aUpdErr, data: updatedApp } = await admin
    .from('saas_apps')
    .update({ is_published: true })
    .eq('slug', project.slug)
    .select('id,slug,is_published')
    .single();
  if (aUpdErr) return c.json({ error: 'saas_apps update failed: ' + aUpdErr.message, project_status: 'published', app_update_failed: true }, 500);
  if (!updatedApp) return c.json({ error: `saas_apps row not found for slug=${project.slug}`, project_status: 'published' }, 500);

  return c.json({ ok: true, id, status: 'published', public_url: `https://${project.slug}.puente-saas.com`, app: updatedApp });
});

// Phase 2: KPI 収集を手動トリガー (super_admin only — 検証/デバッグ/即時実行用)
app.post('/api/admin/collect-kpi', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  try {
    const result = await collectDailyKpi(c.env);
    return c.json(result);
  } catch (err: any) {
    return c.json({ error: err?.message || String(err) }, 500);
  }
});

// オーナー公開停止: published → paused に戻す
app.post('/api/saas/:id/unpublish', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const db = sbu(c);
  const { data: project } = await db
    .from('saas_projects')
    .select('id,slug,company_id,status')
    .eq('id', id)
    .single();
  if (!project) return c.json({ error: 'not found' }, 404);
  if (!(await isSuperAdmin(c.env, uid))) {
    const { data: company } = await db.from('companies').select('id').eq('id', project.company_id).eq('owner_id', uid).maybeSingle();
    if (!company) return c.json({ error: 'forbidden' }, 403);
  }
  const admin = sbAdmin(c.env);
  await admin.from('saas_projects').update({ status: 'paused' }).eq('id', id);
  await admin.from('saas_apps').update({ is_published: false }).eq('slug', project.slug);
  return c.json({ ok: true, id, status: 'paused' });
});

// 修正再投稿（needs_improvement / rejected の��）
app.put('/api/saas/:id/resubmit', auth, async (c) => {
  const id = c.req.param('id');

  // 現在のプロジェクトを取得（RLS でオーナーのみ）
  const { data: existing } = await sbu(c)
    .from('saas_projects')
    .select('id,status,brief')
    .eq('id', id)
    .single();
  if (!existing) return c.json({ error: 'not found' }, 404);
  if (!['needs_improvement', 'rejected', 'draft'].includes(existing.status)) {
    return c.json({ error: 'このステータスでは修正再投稿できません' }, 400);
  }

  const body = await c.req.json();
  const { name, category, overview, target_users, features } = body;
  if (!name || !overview) {
    return c.json({ error: 'サービス名と概要は必須です' }, 400);
  }

  // Brief を更新
  const updatedBrief = {
    name,
    category: category || existing.brief?.category || 'business',
    overview,
    target_users: target_users || '',
    features: Array.isArray(features) ? features.filter(Boolean) : [],
  };

  // ステータスを ai_analyzing にリセットし、ai_plan をクリア
  const { error: updateErr } = await sbAdmin(c.env)
    .from('saas_projects')
    .update({
      brief: updatedBrief,
      name: name,
      category: updatedBrief.category,
      ai_plan: null,
      status: 'ai_analyzing',
    })
    .eq('id', id);
  if (updateErr) return c.json({ error: updateErr.message }, 500);

  // AI 再分析をバックグラウンドで実行
  const env = c.env;
  const analysisPromise = analyzeBrief(env, id, updatedBrief as any).catch((err: Error) => {
    console.error('AI resubmit analysis failed:', err.message, err.stack);
    sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', id);
  });
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof (ctx as any).waitUntil === 'function') {
      (ctx as any).waitUntil(analysisPromise);
    }
  } catch (e) {
    console.error('waitUntil setup failed:', e);
  }

  return c.json({ message: '修正を保存し、AI再分析を開始しました', saas_id: id });
});

app.post('/api/saas/:id/approve', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const id = c.req.param('id');
  const { data, error } = await sbu(c)
    .from('saas_projects')
    .update({ status: 'approved', approved_by: uid, approved_at: new Date().toISOString() })
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
  const db = sbu(c);
  const { data: saas } = await db.from('saas_projects').select('name').eq('id', id).single();
  if (!saas) return c.json({ error: 'not found' }, 404);
  const prices = await createPlanPrices(c.env, id, saas.name);
  for (const p of prices.plans) {
    const unit = { Free: 0, Basic: 980, Standard: 1980, Pro: 2980 }[p.name] ?? 0;
    await db.from('saas_plans').upsert(
      { saas_id: id, name: p.name, price_jpy: unit, stripe_price_id: p.price_id },
      { onConflict: 'saas_id,name' },
    );
  }
  const { data, error } = await db
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
  const db = sbu(c);
  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('id', id)
    .eq('owner_id', uid)
    .maybeSingle();
  if (!company && !(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const { data: monthly } = await db
    .from('v_monthly_revenue')
    .select('*')
    .eq('company_id', id)
    .order('month', { ascending: false })
    .limit(24);
  const { data: balance } = await db
    .from('v_company_connect_balance')
    .select('*')
    .eq('company_id', id)
    .single();
  return c.json({ monthly, balance });
});

// ユーザーの売上取得（company_id不要の簡易エンドポイント）
app.get('/api/my/revenue', auth, async (c) => {
  const uid = c.get('userId');
  const db = sbu(c);
  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('owner_id', uid)
    .limit(1)
    .maybeSingle();
  if (!company) return c.json({ monthly: [], balance: null });
  const { data: monthly } = await db
    .from('v_monthly_revenue')
    .select('*')
    .eq('company_id', company.id)
    .order('month', { ascending: false })
    .limit(12);
  const { data: balance } = await db
    .from('v_company_connect_balance')
    .select('*')
    .eq('company_id', company.id)
    .maybeSingle();
  return c.json({ monthly, balance });
});

// ユーザーが利用中のMicro SaaSアプリ一覧
app.get('/api/my/apps', auth, async (c) => {
  const uid = c.get('userId');
  const db = sbu(c);
  // サブスク一覧（active のみ）
  const { data: subs } = await db
    .from('saas_subscriptions')
    .select('id,app_id,plan,status,created_at')
    .eq('user_id', uid)
    .eq('status', 'active');

  if (!subs || subs.length === 0) return c.json({ apps: [] });

  // アプリ情報を取得
  const appIds = subs.map(s => s.app_id);
  const { data: apps } = await sb(c.env)
    .from('saas_apps')
    .select('id,slug,name,tagline,emoji,color,subdomain')
    .in('id', appIds);

  const appMap = new Map((apps || []).map(a => [a.id, a]));
  const result = subs.map(s => ({
    ...s,
    app: appMap.get(s.app_id) || null,
  }));
  return c.json({ apps: result });
});

app.post('/api/companies/:id/payouts/request', auth, async (c) => {
  const uid = c.get('userId');
  const id = c.req.param('id');
  const db = sbu(c);
  const { data: company } = await db
    .from('companies')
    .select('id')
    .eq('id', id)
    .eq('owner_id', uid)
    .single();
  if (!company) return c.json({ error: 'forbidden' }, 403);
  const body = await c.req.json();
  const { data, error } = await db
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
  const s = sbAdmin(c.env); // service role for admin queries (companies table needs service role access)
  const [
    { count: companies },
    { count: totalProjects },
    { count: publishedSaas },
    { count: activeSubs },
    { count: canceledSubs },
    { data: monthly },
    { data: statusBreakdown },
  ] = await Promise.all([
    s.from('companies').select('*', { count: 'exact', head: true }),
    s.from('saas_projects').select('*', { count: 'exact', head: true }),
    s.from('saas_projects').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    s.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    s.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'canceled'),
    s.from('v_monthly_revenue').select('*').order('month', { ascending: false }).limit(12),
    s.from('saas_projects').select('status'),
  ]);

  // ステータス別集計
  const statusCounts: Record<string, number> = {};
  (statusBreakdown || []).forEach((p: any) => {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  });

  // MRR計算（直近月の合計）
  const latestMonth = monthly?.[0];
  const mrr = latestMonth ? latestMonth.gmv : 0;
  const arr = mrr * 12;

  // 退会率
  const totalSubsEver = (activeSubs || 0) + (canceledSubs || 0);
  const churnRate = totalSubsEver > 0 ? ((canceledSubs || 0) / totalSubsEver * 100).toFixed(1) : '0.0';

  // 課金転換率
  const conversionRate = totalSubsEver > 0 && companies ? ((activeSubs || 0) / (companies || 1) * 100).toFixed(1) : '0.0';

  return c.json({
    companies,
    total_projects: totalProjects,
    saas_published: publishedSaas,
    active_subs: activeSubs,
    canceled_subs: canceledSubs,
    mrr,
    arr,
    churn_rate: parseFloat(churnRate as string),
    conversion_rate: parseFloat(conversionRate as string),
    monthly,
    status_counts: statusCounts,
  });
});

// 管理者: 全プロジェクト一覧（ステータスフィルター付き）
app.get('/api/admin/projects', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const status = c.req.query('status');
  let query = sbAdmin(c.env)
    .from('saas_projects')
    .select('id,name,slug,category,status,ai_plan,brief,created_at,updated_at,company_id')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ projects: data });
});

// 管理者: 全ユーザー一覧
app.get('/api/admin/users', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const { data, error } = await sbAdmin(c.env)
    .from('profiles')
    .select('id,email,display_name,role,created_at')
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ users: data });
});

// 管理者: 全会社一覧
app.get('/api/admin/companies', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const { data, error } = await sbAdmin(c.env)
    .from('companies')
    .select('id,owner_id,legal_name,representative_name,stripe_connect_status,created_at')
    .order('created_at', { ascending: false });
  if (error) return c.json({ error: error.message }, 400);
  return c.json({ companies: data });
});

// ========== Promo cron ==========
app.post('/internal/promo/run', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  const result = await runPromoQueue(c.env);
  return c.json(result);
});

// ========== Stripe coupon reconcile (super_admin専用) ==========
// 共通ロジックは coupons.ts::reconcileAllFounderCoupons() に切り出し、
// scheduled() cron からも再利用する。
app.post('/api/admin/reconcile-founder-coupons', auth, async (c) => {
  const uid = c.get('userId');
  if (!(await isSuperAdmin(c.env, uid))) return c.json({ error: 'forbidden' }, 403);
  try {
    const results = await reconcileAllFounderCoupons(c.env, c.req.query('company_id'));
    return c.json({ processed: results.length, results });
  } catch (err: any) {
    return c.json({ error: err?.message || String(err) }, 500);
  }
});

// ========== Micro SaaS App Engine ==========

// 公開: アプリ一覧（公開済みのみ）
app.get('/api/apps', async (c) => {
  const { data, error } = await sb(c.env)
    .from('saas_apps')
    .select('id,slug,name,tagline,description,category,emoji,color,subdomain,is_official,plans,usage_limits')
    .eq('is_published', true)
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ apps: data });
});

// 公開: アプリ詳細（slug） — preview token 付きなら非公開アプリも取得可
app.get('/api/apps/:slug', async (c) => {
  const slug = c.req.param('slug');
  const previewToken = c.req.query('preview');

  // preview token がある場合は sbAdmin（RLS bypass）で非公開アプリも取得
  const client = previewToken ? sbAdmin(c.env) : sb(c.env);

  let query = client
    .from('saas_apps')
    .select('id,slug,name,tagline,description,category,emoji,color,subdomain,is_official,plans,usage_limits,input_schema,output_format,prompt_template,is_published,preview_token')
    .eq('slug', slug);

  // preview token がなければ公開済みのみ（RLSでも制限されるが明示的に）
  if (!previewToken) {
    query = query.eq('is_published', true);
  }

  const { data, error } = await query.single();
  if (error || !data) return c.json({ error: 'app not found' }, 404);

  // preview token 検証: 非公開アプリはトークン一致必須
  if (!data.is_published && data.preview_token !== previewToken) {
    return c.json({ error: 'app not found' }, 404);
  }

  // prompt_template, preview_token, is_published はフロントに返さない
  const { prompt_template, preview_token: _pt, is_published: _ip, ...publicData } = data as any;
  return c.json(publicData);
});

// 認証: 使用回数チェック
app.get('/api/apps/:slug/usage', auth, async (c) => {
  const uid = c.get('userId');
  const slug = c.req.param('slug');
  const previewToken = c.req.query('preview');

  // アプリID取得 — preview 時は sbAdmin で未公開アプリも引く
  const client = previewToken ? sbAdmin(c.env) : sb(c.env);
  const { data: app } = await client
    .from('saas_apps').select('id,usage_limits').eq('slug', slug).single();
  if (!app) return c.json({ error: 'app not found' }, 404);

  // ユーザーのプラン取得
  const { data: sub } = await sbu(c)
    .from('saas_subscriptions')
    .select('plan')
    .eq('app_id', app.id).eq('user_id', uid).eq('status', 'active')
    .maybeSingle();
  const plan = sub?.plan || 'free';

  // 今月の使用回数
  const { data: usageData } = await sb(c.env).rpc('get_monthly_usage', { p_user_id: uid, p_app_id: app.id });
  const used = typeof usageData === 'number' ? usageData : 0;

  const limits = (app.usage_limits as any) || { free: 3, basic: 30, standard: 100, premium: -1 };
  const limit = limits[plan] ?? 5;
  const remaining = limit === -1 ? -1 : Math.max(0, limit - used);

  return c.json({ plan, used, limit, remaining });
});

// ========== DALL-E コーデイラスト生成 ==========
async function generateCoordinateImage(
  env: Env,
  aiOutput: string,
  inputs: { weather?: string; temperature?: string; gender?: string; style?: string; schedule?: string }
): Promise<string | null> {
  if (!env.OPENAI_API_KEY) return null;

  // AIの出力からアイテム情報を抽出してDALL-Eプロンプトに変換
  const items: string[] = [];
  const patterns = [
    /\*\*トップス\*\*:\s*(.+)/i,
    /\*\*ボトムス\*\*:\s*(.+)/i,
    /\*\*アウター\*\*:\s*(.+)/i,
    /\*\*シューズ\*\*:\s*(.+)/i,
    /\*\*小物\*\*:\s*(.+)/i,
  ];
  for (const pat of patterns) {
    const m = aiOutput.match(pat);
    if (m && m[1] && !m[1].includes('不要') && !m[1].includes('なし')) {
      items.push(m[1].trim().replace(/\(.+?\)/g, '').trim());
    }
  }
  if (items.length === 0) return null;

  const genderLabel = inputs.gender === 'male' ? '男性' : inputs.gender === 'female' ? '女性' : '人物';
  const styleLabel = inputs.style || 'カジュアル';

  const dallePrompt = `Fashion illustration, full-body outfit coordination for a stylish ${genderLabel === '男性' ? 'man' : 'woman'}, ${styleLabel} style. Wearing: ${items.join(', ')}. Clean white background, fashion magazine editorial style, modern Japanese street fashion illustration, soft lighting, watercolor-like artistic rendering. No text or labels.`;

  try {
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: dallePrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      }),
    });

    if (!resp.ok) {
      console.error('DALL-E error:', resp.status, await resp.text());
      return null;
    }

    const result: any = await resp.json();
    return result?.data?.[0]?.url || null;
  } catch (err) {
    console.error('DALL-E fetch error:', err);
    return null;
  }
}

// ========== 商品検索リンク生成ヘルパー ==========
interface ShoppingLink {
  keyword: string;
  rakutenUrl: string;
  amazonUrl: string;
}

function buildRakutenSearchLink(keyword: string, affiliateId?: string): string {
  const encoded = encodeURIComponent(keyword);
  if (affiliateId) {
    return `https://hb.afl.rakuten.co.jp/hgc/${affiliateId}/?pc=https%3A%2F%2Fsearch.rakuten.co.jp%2Fsearch%2Fmall%2F${encoded}%2F&m=https%3A%2F%2Fsearch.rakuten.co.jp%2Fsearch%2Fmall%2F${encoded}%2F`;
  }
  return `https://search.rakuten.co.jp/search/mall/${encoded}/`;
}

function buildAmazonSearchLink(keyword: string, associateTag?: string): string {
  const encoded = encodeURIComponent(keyword);
  return associateTag
    ? `https://www.amazon.co.jp/s?k=${encoded}&tag=${associateTag}`
    : `https://www.amazon.co.jp/s?k=${encoded}`;
}

// 商品検索リンク API（公開）
app.get('/api/products/search', async (c) => {
  const keyword = c.req.query('q') || '';
  if (!keyword) return c.json({ error: 'q is required' }, 400);
  const rakutenUrl = buildRakutenSearchLink(keyword, c.env.RAKUTEN_AFFILIATE_ID);
  const amazonUrl = buildAmazonSearchLink(keyword, c.env.AMAZON_ASSOCIATE_TAG);
  return c.json({ keyword, rakutenUrl, amazonUrl });
});

// ========== ファッション用: AIコーデ → 購入リンク生成 ==========
function enrichFashionWithLinks(
  env: Env,
  aiOutput: string
): { products: Record<string, ShoppingLink> } {
  // AIの出力からアイテムカテゴリを抽出
  const categories: Record<string, string> = {};
  const patterns = [
    { label: 'トップス', regex: /\*\*トップス\*\*:\s*(.+)/i },
    { label: 'ボトムス', regex: /\*\*ボトムス\*\*:\s*(.+)/i },
    { label: 'アウター', regex: /\*\*アウター\*\*:\s*(.+)/i },
    { label: 'シューズ', regex: /\*\*シューズ\*\*:\s*(.+)/i },
    { label: '小物', regex: /\*\*小物\*\*:\s*(.+)/i },
  ];
  for (const p of patterns) {
    const m = aiOutput.match(p.regex);
    if (m && m[1] && !m[1].includes('不要') && !m[1].includes('なし')) {
      categories[p.label] = m[1].trim().replace(/\(.+?\)/g, '').trim();
    }
  }

  const results: Record<string, ShoppingLink> = {};
  for (const [label, keyword] of Object.entries(categories)) {
    results[label] = {
      keyword,
      rakutenUrl: buildRakutenSearchLink(keyword, env.RAKUTEN_AFFILIATE_ID),
      amazonUrl: buildAmazonSearchLink(keyword, env.AMAZON_ASSOCIATE_TAG),
    };
  }
  return { products: results };
}

// 認証: AI 生成エンドポイント
app.post('/api/apps/:slug/generate', auth, async (c) => {
  const uid = c.get('userId');
  const slug = c.req.param('slug');
  const previewToken = c.req.query('preview');
  const body = await c.req.json();

  // アプリ取得 — preview_token があれば未公開アプリでも取得可（プレビュー試用）
  const client = previewToken ? sbAdmin(c.env) : sb(c.env);
  let appQuery = client
    .from('saas_apps')
    .select('id,name,prompt_template,input_schema,usage_limits,is_published,preview_token')
    .eq('slug', slug);
  if (!previewToken) appQuery = appQuery.eq('is_published', true);
  const { data: app } = await appQuery.single();
  if (!app) return c.json({ error: 'app not found' }, 404);
  // preview_token 検証: 非公開アプリはトークン一致必須
  if (!app.is_published && app.preview_token !== previewToken) {
    return c.json({ error: 'app not found' }, 404);
  }

  // プラン & 使用回数チェック
  const { data: sub } = await sbu(c)
    .from('saas_subscriptions')
    .select('plan')
    .eq('app_id', app.id).eq('user_id', uid).eq('status', 'active')
    .maybeSingle();
  const plan = sub?.plan || 'free';

  // Bug 3 fix: Auto-create free subscription if none exists (so app appears in 利用中のSaaS)
  // Must use sbAdmin to bypass RLS (no INSERT policy on saas_subscriptions)
  if (!sub) {
    await sbAdmin(c.env).from('saas_subscriptions').upsert(
      { user_id: uid, app_id: app.id, plan: 'free', status: 'active' },
      { onConflict: 'saas_subscriptions_app_id_user_id_key' },
    );
  }

  const { data: usageCount } = await sb(c.env).rpc('get_monthly_usage', { p_user_id: uid, p_app_id: app.id });
  const used = typeof usageCount === 'number' ? usageCount : 0;
  const limits = (app.usage_limits as any) || { free: 3, basic: 30, standard: 100, premium: -1 };
  const limit = limits[plan] ?? 5;

  if (limit !== -1 && used >= limit) {
    return c.json({
      error: 'usage_limit_exceeded',
      message: `今月の利用回数（${limit}回）に達しました。プランをアップグレードしてください。`,
      used, limit, plan,
    }, 429);
  }

  // プロンプト構築: テンプレートの {{key}} を入力値で置換
  let prompt = app.prompt_template || '';
  const inputSchema = (app.input_schema as any[]) || [];
  for (const field of inputSchema) {
    const val = body[field.key] ?? '';
    prompt = prompt.replace(new RegExp(`\\{\\{${field.key}\\}\\}`, 'g'), String(val));
  }

  // ファッション系アプリの場合: プロンプトに購入リンク指示を追加
  const isFashionApp = slug === 'fashion-ai';
  if (isFashionApp) {
    prompt += `\n\n重要: 各アイテムは具体的なブランド名・色・素材を含めて、検索しやすいキーワードで提案してください。`;
  }

  // Anthropic Claude 呼び出し
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey: c.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const output = message.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  // ファッション系: 購入リンク生成 + DALL-Eイラスト生成（並列実行）
  let products: Record<string, ShoppingLink> | undefined;
  let illustrationUrl: string | null = null;
  if (isFashionApp) {
    const [linksResult, imageResult] = await Promise.all([
      Promise.resolve().then(() => {
        try {
          const enriched = enrichFashionWithLinks(c.env, output);
          return Object.keys(enriched.products).length > 0 ? enriched.products : undefined;
        } catch { return undefined; }
      }),
      generateCoordinateImage(c.env, output, body).catch(() => null),
    ]);
    products = linksResult;
    illustrationUrl = imageResult;
  }

  // 使用回数記録
  await sbu(c).from('app_usage').insert({
    user_id: uid,
    app_id: app.id,
    input: body,
    output: output.slice(0, 5000),
    tokens_used: (message.usage?.input_tokens || 0) + (message.usage?.output_tokens || 0),
  });

  return c.json({
    output,
    products,
    illustration_url: illustrationUrl,
    used: used + 1,
    limit,
    remaining: limit === -1 ? -1 : Math.max(0, limit - used - 1),
  });
});

// 認証: 使用履歴
app.get('/api/apps/:slug/history', auth, async (c) => {
  const uid = c.get('userId');
  const slug = c.req.param('slug');
  const previewToken = c.req.query('preview');

  const client = previewToken ? sbAdmin(c.env) : sb(c.env);
  const { data: app } = await client.from('saas_apps').select('id').eq('slug', slug).single();
  if (!app) return c.json({ error: 'app not found' }, 404);

  const { data } = await sbu(c)
    .from('app_usage')
    .select('id,input,output,created_at')
    .eq('app_id', app.id).eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(20);

  return c.json({ history: data || [] });
});

// ===== Micro SaaS App Stripe Checkout =====
// POST /api/apps/:slug/checkout — Create Stripe Checkout Session for app subscription
app.post('/api/apps/:slug/checkout', auth, async (c) => {
  const uid = c.get('userId');
  const slug = c.req.param('slug');
  const body = await c.req.json<{ plan: 'basic' | 'standard' | 'premium' }>();
  const planKey = body.plan;

  if (!planKey || !['basic', 'standard', 'premium'].includes(planKey)) {
    return c.json({ error: 'plan must be "basic", "standard", or "premium"' }, 400);
  }

  try {
    // Get app info (admin で RLS bypass — 誰でも published app は見える前提)
    // ★ is_official + owner_id を取得してマルチテナント／公式の分岐に使う
    const { data: appData, error: appErr } = await sbAdmin(c.env)
      .from('saas_apps')
      .select('id,slug,name,emoji,stripe_product_id,is_official,owner_id')
      .eq('slug', slug)
      .single();
    if (appErr || !appData) return c.json({ error: 'app not found: ' + (appErr?.message || slug) }, 404);

    // ★ マルチテナント (is_official=false) は Stripe Connect Destination Charges 必須
    //   - owner の company から stripe_connect_account_id を取得
    //   - charges_enabled=true でなければ 400 で reject
    //   - 公式 (is_official=true) は Puente 自社運営 = Connect 不要
    const isOfficial = appData.is_official === true;
    let connectAccountId: string | null = null;
    if (!isOfficial) {
      if (!appData.owner_id) {
        return c.json({ error: 'owner_id missing on saas_apps. データ不整合。', code: 'no_owner' }, 500);
      }
      const { data: ownerCompany } = await sbAdmin(c.env)
        .from('companies')
        .select('id,stripe_connect_account_id,stripe_charges_enabled')
        .eq('owner_id', appData.owner_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!ownerCompany?.stripe_connect_account_id || !ownerCompany?.stripe_charges_enabled) {
        return c.json({
          error: 'このアプリのオーナーが収益受け取り設定 (Stripe Connect) を完了していないため、課金を受け付けられません。オーナーに連絡してください。',
          code: 'connect_not_ready',
        }, 400);
      }
      connectAccountId = ownerCompany.stripe_connect_account_id;
    }

    // Get user's Supabase auth email via admin (requires service role key)
    let customerEmail = '';
    try {
      const { data: { user: authUser } } = await sbAdmin(c.env).auth.admin.getUserById(uid);
      customerEmail = authUser?.email || '';
    } catch(e) {
      // Fallback: try to get email from profiles table (admin で RLS bypass)
      const { data: emailProfile } = await sbAdmin(c.env).from('profiles').select('email').eq('id', uid).single();
      customerEmail = emailProfile?.email || '';
    }
    if (!customerEmail) return c.json({ error: 'ユーザーメールアドレスが取得できません' }, 400);

    const stripe = stripeClient(c.env);

    // Plan config
    const planConfig: Record<string, { name: string; price: number }> = {
      basic:    { name: 'Basic（月30回）', price: 980 },
      standard: { name: 'Standard（月100回）', price: 1980 },
      premium:  { name: 'Premium（無制限）', price: 2980 },
    };
    const plan = planConfig[planKey];

    // Lazy-create Stripe Product + Prices if not exists
    // NOTE: update は sbAdmin で実行する必要あり (user JWT の sb() だと RLS で blocked)
    let productId = appData.stripe_product_id;
    if (!productId) {
      const product = await stripe.products.create({
        name: `${appData.emoji || ''} ${appData.name} — Punete Micro SaaS`.trim(),
        metadata: { app_id: appData.id, slug: appData.slug, is_official: String(isOfficial) },
      });
      productId = product.id;
      const { error: upErr } = await sbAdmin(c.env)
        .from('saas_apps')
        .update({ stripe_product_id: productId })
        .eq('id', appData.id);
      if (upErr) console.error('[checkout] saas_apps.stripe_product_id 保存失敗:', upErr);
    }

    // Find or create price for this plan
    const existingPrices = await stripe.prices.list({
      product: productId,
      active: true,
      limit: 100,
    });
    let priceId = existingPrices.data.find(
      (p) => p.unit_amount === plan.price && p.recurring?.interval === 'month' && p.currency === 'jpy'
    )?.id;

    if (!priceId) {
      const newPrice = await stripe.prices.create({
        product: productId,
        unit_amount: plan.price,
        currency: 'jpy',
        recurring: { interval: 'month' },
        tax_behavior: 'inclusive',
        metadata: { app_id: appData.id, plan_name: planKey },
      });
      priceId = newPrice.id;
    }

    // Determine origin for success/cancel URLs
    const origin = c.req.header('origin') || `https://${slug}.puente-saas.com`;

    // Build subscription_data — マルチテナントは Connect Destination Charges
    const subscriptionData: any = {
      metadata: {
        app_id: appData.id,
        app_slug: appData.slug,
        plan_name: planKey,
        user_id: uid,
        kind: 'app_subscription',
        is_official: String(isOfficial),
      },
    };
    if (!isOfficial && connectAccountId) {
      // ★ 70/30 自動分配: application_fee_percent=70 で Puente 取り分、残り 30% は Connect 経由でユーザーへ
      subscriptionData.application_fee_percent = 70;
      subscriptionData.transfer_data = { destination: connectAccountId };
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: customerEmail,
      allow_promotion_codes: true,
      success_url: `${origin}?checkout=success`,
      cancel_url: `${origin}?checkout=cancel`,
      subscription_data: subscriptionData,
      metadata: {
        app_id: appData.id,
        app_slug: appData.slug,
        plan_name: planKey,
        user_id: uid,
        kind: 'app_subscription',
        is_official: String(isOfficial),
      },
    });

    return c.json({
      url: session.url,
      session_id: session.id,
      revenue_share: isOfficial ? 'puente_only' : '70_puente_30_owner',
    });
  } catch (e: any) {
    // Stripe / DB の実エラー内容をフロントに返す（decode して原因切り分け容易に）
    const msg = e?.message || 'unknown error';
    const code = e?.code || e?.type || null;
    console.error('[checkout] failed:', msg, code, e);
    return c.json({ error: msg, code, kind: 'checkout_failed' }, 500);
  }
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
    // 並列実行:
    // 1. プロモーション配信キュー
    // 2. クーポン DB↔Stripe 自動同期
    // 3. published SaaS の日次 KPI スナップショット (Phase 2 自己改善ループ用)
    await Promise.allSettled([
      runPromoQueue(env).catch((e) => console.error('[scheduled] runPromoQueue failed:', e)),
      reconcileAllFounderCoupons(env)
        .then((results) => {
          const created = results.filter((r) => r.status === 'created').length;
          const errors = results.filter((r) => r.status === 'error').length;
          if (created > 0 || errors > 0) {
            console.log(`[scheduled] coupon reconcile: ${created} created, ${errors} errors, ${results.length} total`);
          }
        })
        .catch((e) => console.error('[scheduled] reconcileAllFounderCoupons failed:', e)),
      collectDailyKpi(env)
        .then((r) => console.log(`[scheduled] KPI collected: ${r.saved}/${r.processed} apps`))
        .catch((e) => console.error('[scheduled] collectDailyKpi failed:', e)),
    ]);
  },
};
