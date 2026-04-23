// Punete Micro SaaS Store — 80%OFF クーポン自動発行
// 1社につき1回限り（初期費用 330,000 JPY → 66,000 JPY）

import { stripeClient } from './stripe';
import { sb, sbAdmin } from './supabase';
import type { Env } from './types';

export type ReconcileResult = { company_id: string; code: string; status: 'already_exists' | 'created' | 'error'; stripe_coupon_id?: string; note?: string };

/**
 * DB の coupons 行に対応する Stripe coupon + promotion_code を冪等に作成する。
 * 既に Stripe 側に同一 promotion code が存在すればスキップ。
 * scheduled() からも /api/admin/reconcile-founder-coupons からも呼ばれる共通ロジック。
 */
export async function reconcileAllFounderCoupons(env: Env, companyIdFilter?: string): Promise<ReconcileResult[]> {
  const s = sbAdmin(env);
  let query = s.from('coupons').select('code,company_id,discount_percent').eq('discount_percent', 80);
  if (companyIdFilter) query = query.eq('company_id', companyIdFilter);
  const { data: rows, error } = await query;
  if (error) throw new Error(`reconcile query failed: ${error.message}`);

  const stripe = stripeClient(env);
  const results: ReconcileResult[] = [];

  for (const row of rows ?? []) {
    try {
      const existing = await stripe.promotionCodes.list({ code: row.code, limit: 1 });
      if (existing.data.length > 0) {
        results.push({ company_id: row.company_id, code: row.code, status: 'already_exists', stripe_coupon_id: existing.data[0].coupon?.toString() });
        continue;
      }
      const coupon = await stripe.coupons.create({
        percent_off: 80,
        duration: 'once',
        name: 'Puente Founder 80% OFF',
        metadata: { company_id: row.company_id },
      });
      await stripe.promotionCodes.create({
        coupon: coupon.id,
        code: row.code,
        max_redemptions: 1,
        metadata: { company_id: row.company_id },
      });
      results.push({ company_id: row.company_id, code: row.code, status: 'created', stripe_coupon_id: coupon.id });
    } catch (err: any) {
      results.push({ company_id: row.company_id, code: row.code, status: 'error', note: err?.message || String(err) });
    }
  }
  return results;
}

export async function issueInitialDiscount(env: Env, companyId: string) {
  const s = sb(env);
  // 既に発行済みかチェック
  const { data: existing } = await s
    .from('coupons')
    .select('id,code,discount_percent')
    .eq('company_id', companyId)
    .eq('discount_percent', 80)
    .maybeSingle();
  if (existing) return { code: existing.code, stripe_coupon_id: null, reused: true };

  const code = `PUENTE-${companyId.slice(0, 8).toUpperCase()}-FND`;

  // Stripe 側に coupon + promotion code を作成。失敗してもDB保存は継続し、
  // スーパーアドミンが後追いで手動作成できるようにする（ダッシュボード表示は先行する）。
  let stripeCouponId: string | null = null;
  try {
    const coupon = await stripeClient(env).coupons.create({
      percent_off: 80,
      duration: 'once',
      name: 'Puente Founder 80% OFF',
      metadata: { company_id: companyId },
    });
    await stripeClient(env).promotionCodes.create({
      coupon: coupon.id,
      code,
      max_redemptions: 1,
      metadata: { company_id: companyId },
    });
    stripeCouponId = coupon.id;
  } catch (err) {
    console.error('Stripe coupon creation failed (will proceed with DB insert):', err);
  }

  // DB スキーマは (id, company_id, code, discount_percent, used_at, created_at) のみ。
  // stripe_coupon_id / stripe_promotion_code カラムは存在しないため INSERT しない。
  // insert エラーは throw する（会社登録時に呼ばれるため、上位で return c.json(error) される）。
  const { error } = await s.from('coupons').insert({
    company_id: companyId,
    code,
    discount_percent: 80,
  });
  if (error) {
    console.error('Coupon DB insert failed:', error);
    throw new Error(`coupon insert failed: ${error.message}`);
  }

  return { code, stripe_coupon_id: stripeCouponId, reused: false };
}
