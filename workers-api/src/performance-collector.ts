// Puente Micro SaaS — 日次 KPI 集計 (Phase 2 自己改善ループの土台)
// published saas_apps ごとに conversion_rate / mrr / active_users を計算し
// public.saas_performance_history にアップサートする。scheduled() から呼ばれる。

import type { Env } from './types';
import { sbAdmin } from './supabase';

const PLAN_PRICE_JPY: Record<string, number> = {
  free: 0,
  basic: 980,
  standard: 1980,
  premium: 2980,
};

export async function collectDailyKpi(env: Env): Promise<{ processed: number; saved: number }> {
  const s = sbAdmin(env);
  const today = new Date().toISOString().slice(0, 10);

  const { data: apps, error: appErr } = await s
    .from('saas_apps')
    .select('id')
    .eq('is_published', true);
  if (appErr) { console.error('[collectDailyKpi] apps query failed:', appErr); return { processed: 0, saved: 0 }; }

  let saved = 0;
  for (const app of apps ?? []) {
    try {
      // 対象アプリの全サブスクリプションを引く
      const { data: subs } = await s
        .from('saas_subscriptions')
        .select('user_id,plan,status,created_at,current_period_end,updated_at')
        .eq('app_id', app.id);

      const allSubs = subs ?? [];
      const userIds = new Set(allSubs.map((s) => s.user_id).filter(Boolean));
      const activeSubs = allSubs.filter((s) => s.status === 'active');
      const paidActive = activeSubs.filter((s) => (PLAN_PRICE_JPY[s.plan] ?? 0) > 0);
      const mrr = paidActive.reduce((acc, s) => acc + (PLAN_PRICE_JPY[s.plan] ?? 0), 0);

      const totalUsers = userIds.size;
      const activeUsers = new Set(activeSubs.map((s) => s.user_id)).size;
      const paidUsers = new Set(paidActive.map((s) => s.user_id)).size;

      const conversionRate = totalUsers > 0 ? paidUsers / totalUsers : null;

      // 30 日以内に canceled になったサブ
      const now = Date.now();
      const d30 = 30 * 24 * 3600 * 1000;
      const canceled30d = allSubs.filter((s) => s.status === 'canceled' && s.updated_at && (now - Date.parse(s.updated_at)) <= d30);
      const totalAtPeriodStart = allSubs.filter((s) => s.created_at && (now - Date.parse(s.created_at)) >= 0).length;
      const churnRate30d = totalAtPeriodStart > 0 ? canceled30d.length / totalAtPeriodStart : null;

      // 30 日間継続利用しているユーザー (簡易)
      const retained30d = activeSubs.filter((s) => s.created_at && (now - Date.parse(s.created_at)) >= d30);
      const retention30d = totalUsers > 0 ? retained30d.length / totalUsers : null;

      const { error: upErr } = await s.from('saas_performance_history').upsert({
        saas_id: app.id,
        date: today,
        conversion_rate: conversionRate,
        retention_7d: null, // future: session tracking から算出
        retention_30d: retention30d,
        mrr_jpy: mrr,
        churn_rate_30d: churnRate30d,
        active_users: activeUsers,
        total_users: totalUsers,
      }, { onConflict: 'saas_id,date' });
      if (!upErr) saved++;
      else console.error('[collectDailyKpi] upsert failed for', app.id, upErr);
    } catch (e) {
      console.error('[collectDailyKpi] app failed:', app.id, e);
    }
  }
  return { processed: apps?.length ?? 0, saved };
}
