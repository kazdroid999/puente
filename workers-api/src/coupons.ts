// Punete Micro SaaS Store — 80%OFF クーポン自動発行
// 1社につき1回限り（初期費用 330,000 JPY → 66,000 JPY）

import { stripeClient } from './stripe';
import { sb } from './supabase';
import type { Env } from './types';

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
