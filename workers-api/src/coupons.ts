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

  const stripe = stripeClient(env);
  const coupon = await stripe.coupons.create({
    percent_off: 80,
    duration: 'once',
    name: 'Puente Founder 80% OFF',
    metadata: { company_id: companyId },
  });
  const code = `PUENTE-${companyId.slice(0, 8).toUpperCase()}-FND`;
  const promo = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code,
    max_redemptions: 1,
    metadata: { company_id: companyId },
  });
  await s.from('coupons').insert({
    company_id: companyId,
    code,
    stripe_coupon_id: coupon.id,
    stripe_promotion_code: promo.id,
    discount_percent: 80,
  });
  return { code, stripe_coupon_id: coupon.id, reused: false };
}
