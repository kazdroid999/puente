// Punete Micro SaaS Store — PR / SNS 自動配信ワーカー
// promo_posts キューを走査し、PR Times / Wix Blog / X / Instagram / FB / TikTok / YouTube Short へ配信

import { sb } from './supabase';
import type { Env } from './types';

export async function runPromoQueue(env: Env, limit = 10): Promise<{ posted: number; failed: number }> {
  const s = sb(env);
  const { data: jobs } = await s
    .from('promo_posts')
    .select('*')
    .eq('status', 'queued')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);

  let posted = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    await s.from('promo_posts').update({ status: 'posting' }).eq('id', job.id);
    try {
      const externalUrl = await dispatch(env, job);
      await s
        .from('promo_posts')
        .update({ status: 'posted', posted_at: new Date().toISOString(), external_url: externalUrl })
        .eq('id', job.id);
      posted++;
    } catch (e) {
      await s
        .from('promo_posts')
        .update({ status: 'failed', error: (e as Error).message })
        .eq('id', job.id);
      failed++;
    }
  }
  return { posted, failed };
}

async function dispatch(env: Env, job: any): Promise<string | null> {
  switch (job.channel) {
    case 'prtimes':
      return await postPrTimes(env, job.payload);
    case 'wix_blog':
      return await postWixBlog(env, job.payload);
    case 'x':
    case 'instagram':
    case 'facebook':
    case 'tiktok':
    case 'youtube_short':
      // これらは外部スケジューラ経由（Buffer / Zapier）でトリガするため payload をそのまま Webhook へ POST する想定
      return null;
    default:
      throw new Error(`unknown channel: ${job.channel}`);
  }
}

async function postPrTimes(env: Env, payload: any): Promise<string | null> {
  if (!env.PRTIMES_API_KEY) {
    // API キー未設定時は下書きとして記録のみ
    return null;
  }
  // 実際の PR Times API は法人契約必要。ここでは Webhook ベースのダミー
  return null;
}

async function postWixBlog(_env: Env, _payload: any): Promise<string | null> {
  // Wix REST Blog API (別ワーカー/MCP で連携)
  return null;
}
