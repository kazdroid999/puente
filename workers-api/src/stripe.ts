// Punete Micro SaaS Store — Stripe Connect (Destination Charges)
// 売上分配方式: application_fee_amount = amount × 0.70 (プエンテ70%)
// 残り30%は Connect アカウント（ユーザー法人）へ自動入金 = ユーザー自身の売上

import Stripe from 'stripe';
import type { Env } from './types';
import { sb, sbAdmin } from './supabase';

const PUENTE_SHARE = 0.70;     // プエンテ売上比率
const USER_SHARE = 0.30;       // ユーザー売上比率

export function stripeClient(env: Env): Stripe {
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

// ========== Connect Onboarding ==========
// 既に企業の Connect アカウントがある場合は再利用、無ければ新規作成。
// Stripe 側にだけ作られて DB に紐付かない孤児アカウントは、metadata.company_id を
// 頼りに account.list で復元してリカバリする。
export async function createConnectAccount(env: Env, companyId: string, email: string) {
  const stripe = stripeClient(env);
  const admin = sbAdmin(env);

  // 1. companies.stripe_connect_account_id が既にあるならそれを使う
  const { data: company } = await admin
    .from('companies')
    .select('stripe_connect_account_id')
    .eq('id', companyId)
    .single();
  let accountId = company?.stripe_connect_account_id || null;

  // 2. DB に無いなら Stripe API で metadata.company_id 検索 → 既存アカウントを発見できれば再利用
  if (!accountId) {
    try {
      const list = await stripe.accounts.list({ limit: 100 });
      const found = list.data.find((a) => a.metadata?.company_id === companyId);
      if (found) {
        accountId = found.id;
        await admin
          .from('companies')
          .update({
            stripe_connect_account_id: accountId,
            stripe_connect_status: found.charges_enabled ? 'active' : 'onboarding',
            stripe_charges_enabled: !!found.charges_enabled,
            stripe_payouts_enabled: !!found.payouts_enabled,
          })
          .eq('id', companyId);
        console.log(`[Connect] reused orphan account ${accountId} for company ${companyId}`);
      }
    } catch (e) {
      console.warn('[Connect] account list lookup failed (non-fatal):', e);
    }
  }

  // 3. それでも無ければ新規作成
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'standard',
      country: 'JP',
      email,
      metadata: { company_id: companyId },
    });
    accountId = account.id;
    // ★ admin (service_role) で update — sb(env) だと user JWT で RLS にブロックされて null のまま残る
    const { error: upErr } = await admin
      .from('companies')
      .update({ stripe_connect_account_id: accountId, stripe_connect_status: 'onboarding' })
      .eq('id', companyId);
    if (upErr) console.error('[Connect] companies update failed:', upErr.message);
  }

  // 4. Account Link を発行 → ユーザー onboarding 用 URL
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${env.APP_ORIGIN}/dashboard/connect/refresh`,
    return_url: `${env.APP_ORIGIN}/dashboard/connect/return`,
    type: 'account_onboarding',
  });
  return { account_id: accountId, onboarding_url: link.url };
}

// ========== Connect 状態 同期 (return_url 着地時 / 手動 refresh 用) ==========
// Webhook account.updated に頼らず Stripe API から最新状態を直接 pull して
// companies テーブルへ即時反映する。onboarding 完了直後の UX 改善用。
export async function refreshConnectStatus(env: Env, companyId: string) {
  const admin = sbAdmin(env);
  const { data: company } = await admin
    .from('companies')
    .select('stripe_connect_account_id')
    .eq('id', companyId)
    .single();
  if (!company?.stripe_connect_account_id) {
    return { error: 'not_connected' as const, status: 404 as const };
  }
  const stripe = stripeClient(env);
  const acct = await stripe.accounts.retrieve(company.stripe_connect_account_id);
  const newStatus = acct.charges_enabled
    ? 'active'
    : acct.details_submitted
      ? 'restricted'
      : 'onboarding';
  await admin
    .from('companies')
    .update({
      stripe_charges_enabled: !!acct.charges_enabled,
      stripe_payouts_enabled: !!acct.payouts_enabled,
      stripe_connect_status: newStatus,
    })
    .eq('id', companyId);
  return {
    charges_enabled: !!acct.charges_enabled,
    payouts_enabled: !!acct.payouts_enabled,
    details_submitted: !!acct.details_submitted,
    status: newStatus,
    requirements: (acct.requirements?.currently_due || []).slice(0, 10),
  };
}

// ========== Product / Price 作成 (SaaS 公開時) ==========
export async function createPlanPrices(env: Env, saasId: string, saasName: string) {
  const stripe = stripeClient(env);
  const product = await stripe.products.create({
    name: saasName,
    metadata: { saas_id: saasId },
  });

  const plans = [
    { name: 'Free', price: 0 },
    { name: 'Basic', price: 980 },
    { name: 'Standard', price: 1980 },
    { name: 'Pro', price: 2980 },
  ];
  const results = [];
  for (const p of plans) {
    if (p.price === 0) {
      results.push({ name: p.name, price_id: null });
      continue;
    }
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: p.price,
      currency: 'jpy',
      recurring: { interval: 'month' },
      tax_behavior: 'inclusive',
      metadata: { saas_id: saasId, plan_name: p.name },
    });
    results.push({ name: p.name, price_id: price.id });
  }
  await sb(env).from('saas_projects').update({ stripe_product_id: product.id }).eq('id', saasId);
  return { product_id: product.id, plans: results };
}

// ========== Checkout Session (エンドユーザー課金) ==========
// Destination Charges: application_fee_amount でプエンテ70%を自動控除
export async function createCheckoutSession(
  env: Env,
  args: { saasId: string; planName: string; customerEmail: string; successUrl: string; cancelUrl: string },
) {
  const stripe = stripeClient(env);
  const { data: plan } = await sb(env)
    .from('saas_plans')
    .select('price_jpy,stripe_price_id,saas_id,name')
    .eq('saas_id', args.saasId)
    .eq('name', args.planName)
    .single();
  if (!plan?.stripe_price_id) {
    return { error: 'Plan not found', status: 404 } as any;
  }

  const { data: saas } = await sb(env)
    .from('saas_projects')
    .select('company_id, companies(stripe_connect_account_id,stripe_charges_enabled)')
    .eq('id', args.saasId)
    .single();
  const connectAcct = (saas as any)?.companies?.stripe_connect_account_id;
  const chargesEnabled = (saas as any)?.companies?.stripe_charges_enabled;
  if (!connectAcct || !chargesEnabled) {
    return { error: 'Connect account not ready', status: 400 } as any;
  }

  const appFee = Math.round(plan.price_jpy * PUENTE_SHARE);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    customer_email: args.customerEmail,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    subscription_data: {
      application_fee_percent: PUENTE_SHARE * 100,
      transfer_data: { destination: connectAcct },
      metadata: { saas_id: args.saasId, plan_name: args.planName },
    },
    metadata: { saas_id: args.saasId, plan_name: args.planName, kind: 'end_user_subscription' },
  });
  return { url: session.url, session_id: session.id };
}

// ========== 初期費用 (30万円 + 税 = 330,000 JPY / 80%OFFクーポン後 66,000 JPY) ==========
export async function createInitialFeeCheckout(
  env: Env,
  args: { companyId: string; amountJpy: number; successUrl: string; cancelUrl: string },
) {
  const stripe = stripeClient(env);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: 'jpy',
          product_data: { name: 'Punete Micro SaaS Store 初期費用（ローンチ費）' },
          unit_amount: args.amountJpy,
          tax_behavior: 'inclusive',
        },
        quantity: 1,
      },
    ],
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    metadata: { company_id: args.companyId, kind: 'initial_fee' },
  });
  await sb(env).from('initial_fee_invoices').insert({
    company_id: args.companyId,
    amount_jpy: args.amountJpy,
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    status: 'pending',
  });
  return { url: session.url, session_id: session.id };
}

// ========== Webhook 署名検証 + イベント処理 ==========
export async function handleWebhook(env: Env, req: Request): Promise<Response> {
  const stripe = stripeClient(env);
  const sig = req.headers.get('stripe-signature');
  if (!sig) return new Response('missing signature', { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return new Response(`signature verification failed: ${(err as Error).message}`, { status: 400 });
  }

  // Use sbAdmin (service role) to bypass RLS — Webhook has no user session
  const s = sbAdmin(env);

  switch (event.type) {
    case 'account.updated': {
      const acct = event.data.object as Stripe.Account;
      await s
        .from('companies')
        .update({
          stripe_charges_enabled: acct.charges_enabled,
          stripe_payouts_enabled: acct.payouts_enabled,
          stripe_connect_status: acct.charges_enabled ? 'active' : 'restricted',
        })
        .eq('stripe_connect_account_id', acct.id);
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

      // Handle Micro SaaS App subscriptions (kind=app_subscription)
      if (sub.metadata.kind === 'app_subscription') {
        const appId = sub.metadata.app_id;
        const userId = sub.metadata.user_id;

        // Resolve plan name from actual price amount (handles upgrades/downgrades via Stripe)
        let planName = sub.metadata.plan_name || 'basic';
        const priceAmount = sub.items?.data?.[0]?.price?.unit_amount;
        if (typeof priceAmount === 'number') {
          const priceToPlan: Record<number, string> = { 980: 'basic', 1980: 'standard', 2980: 'premium' };
          planName = priceToPlan[priceAmount] || planName;
        }

        // Determine status: canceled/past_due → handle gracefully
        let dbStatus = sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status;
        // If subscription canceled at period end, keep active until period ends
        if (sub.cancel_at_period_end && sub.status === 'active') {
          dbStatus = 'active'; // still active until period_end
        }

        if (appId && userId) {
          await s.from('saas_subscriptions').upsert(
            {
              user_id: userId,
              app_id: appId,
              plan: planName,
              stripe_subscription_id: sub.id,
              stripe_customer_id: customerId,
              status: dbStatus,
              current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
              current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            },
            { onConflict: 'saas_subscriptions_app_id_user_id_key' },
          );
        }
      } else {
        // Legacy SaaS project subscriptions
        const saasId = sub.metadata.saas_id;
        const planName = sub.metadata.plan_name;
        await s.from('subscriptions').upsert(
          {
            saas_id: saasId,
            end_user_email: (sub as any).customer_email ?? '',
            stripe_customer_id: customerId,
            stripe_subscription_id: sub.id,
            plan_name: planName,
            status: sub.status,
            current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
            current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
            canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
          },
          { onConflict: 'stripe_subscription_id' },
        );
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      // Handle both app subscriptions and legacy subscriptions
      if (sub.metadata.kind === 'app_subscription') {
        await s
          .from('saas_subscriptions')
          .update({ status: 'canceled', plan: 'free' })
          .eq('stripe_subscription_id', sub.id);
      } else {
        await s
          .from('subscriptions')
          .update({ status: 'canceled', canceled_at: new Date().toISOString() })
          .eq('stripe_subscription_id', sub.id);
      }
      break;
    }
    case 'charge.succeeded': {
      // 売上分配イベントを記録
      // - 旧方式: charge.metadata.saas_id → saas_projects.id を直接参照
      // - 新方式 (/api/apps/:slug/checkout 経由): subscription.metadata.app_id → saas_apps
      //   → saas_apps.idea_id (=saas_projects.id) と company_id を引いて記録
      // 公式アプリ (is_official=true) は Connect なし、application_fee=0 で全額 Puente 計上
      const charge = event.data.object as Stripe.Charge;
      const amount = charge.amount;
      const appFee = typeof charge.application_fee_amount === 'number' ? charge.application_fee_amount : 0;
      const userRev = appFee > 0 ? amount - appFee : 0;
      const puenteRev = appFee > 0 ? appFee : amount; // Connect 無し時は Puente 全額

      let saasId: string | null = (charge.metadata?.saas_id as string) || null;
      let companyId: string | null = null;

      // 新方式: invoice → subscription → metadata.app_id を引く
      if (!saasId && charge.invoice) {
        try {
          const stripeApi = stripeClient(env);
          const invoiceId = typeof charge.invoice === 'string' ? charge.invoice : charge.invoice.id;
          const inv = await stripeApi.invoices.retrieve(invoiceId, { expand: ['subscription'] });
          const sub = (inv as any).subscription as Stripe.Subscription | null;
          const appId = (sub?.metadata as any)?.app_id || null;
          if (appId) {
            const { data: app } = await s
              .from('saas_apps')
              .select('id,idea_id,owner_id,is_official')
              .eq('id', appId)
              .maybeSingle();
            if (app) {
              saasId = app.idea_id || app.id;
              if (app.idea_id) {
                const { data: project } = await s
                  .from('saas_projects')
                  .select('company_id')
                  .eq('id', app.idea_id)
                  .maybeSingle();
                if (project?.company_id) companyId = project.company_id;
              } else if (app.owner_id) {
                const { data: comp } = await s
                  .from('companies')
                  .select('id')
                  .eq('owner_id', app.owner_id)
                  .order('created_at', { ascending: false })
                  .limit(1)
                  .maybeSingle();
                if (comp?.id) companyId = comp.id;
              }
            }
          }
        } catch (e: any) {
          console.error('[charge.succeeded] subscription lookup failed:', e?.message ?? e);
        }
      }

      // 旧 saas_id 経路 (legacy /public/saas/:id/checkout) でも company_id を埋める
      if (saasId && !companyId) {
        const { data: project } = await s
          .from('saas_projects')
          .select('company_id')
          .eq('id', saasId)
          .maybeSingle();
        if (project?.company_id) companyId = project.company_id;
      }

      if (saasId) {
        const { error: revErr } = await s.from('revenue_events').upsert(
          {
            saas_id: saasId,
            company_id: companyId,
            stripe_payment_intent_id: typeof charge.payment_intent === 'string' ? charge.payment_intent : null,
            stripe_charge_id: charge.id,
            gross_amount_jpy: amount,
            puente_revenue_jpy: puenteRev,
            user_revenue_jpy: userRev,
            application_fee_jpy: appFee,
            stripe_fee_jpy: null,
            occurred_at: new Date(charge.created * 1000).toISOString(),
          },
          { onConflict: 'stripe_payment_intent_id' },
        );
        if (revErr) console.error('[charge.succeeded] revenue_events upsert failed:', revErr.message);
        else console.log(`[charge.succeeded] revenue_events: saas=${saasId} gross=${amount} puente=${puenteRev} user=${userRev}`);
      } else {
        console.warn('[charge.succeeded] could not determine saas_id for charge', charge.id);
      }
      break;
    }
    case 'checkout.session.completed': {
      const sess = event.data.object as Stripe.Checkout.Session;
      if (sess.metadata?.kind === 'initial_fee') {
        const companyId = sess.metadata.company_id;
        await s
          .from('initial_fee_invoices')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('status', 'pending');
        await s
          .from('companies')
          .update({ first_launch_at: new Date().toISOString() })
          .eq('id', companyId)
          .is('first_launch_at', null);
      }
      // App subscription checkout completed — ensure saas_subscriptions row exists
      if (sess.metadata?.kind === 'app_subscription') {
        const appId = sess.metadata.app_id;
        const userId = sess.metadata.user_id;
        const planName = sess.metadata.plan_name;
        const subId = typeof sess.subscription === 'string' ? sess.subscription : '';
        const custId = typeof sess.customer === 'string' ? sess.customer : '';
        if (appId && userId && subId) {
          await s.from('saas_subscriptions').upsert(
            {
              user_id: userId,
              app_id: appId,
              plan: planName || 'basic',
              stripe_subscription_id: subId,
              stripe_customer_id: custId,
              status: 'active',
            },
            { onConflict: 'saas_subscriptions_app_id_user_id_key' },
          );
        }
      }
      break;
    }
    case 'payout.paid': {
      const payout = event.data.object as Stripe.Payout;
      await s
        .from('payouts')
        .update({ status: 'paid', paid_at: new Date(payout.arrival_date * 1000).toISOString() })
        .eq('stripe_payout_id', payout.id);
      break;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'content-type': 'application/json' },
  });
}

export { PUENTE_SHARE, USER_SHARE };
