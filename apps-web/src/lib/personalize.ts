// 匿名訪問者ID (Cookie) + 閲覧履歴ベースのパーソナライズ
import { cookies } from 'next/headers';
import { createClient } from './supabase-server';

const VID_COOKIE = 'puente_vid';

export function getVisitorId(): string {
  const store = cookies();
  let vid = store.get(VID_COOKIE)?.value;
  if (!vid) {
    vid = crypto.randomUUID();
    try {
      store.set(VID_COOKIE, vid, { maxAge: 60 * 60 * 24 * 365, httpOnly: false, sameSite: 'lax' });
    } catch {}
  }
  return vid;
}

export async function trackView(saasId: string, category: string | null) {
  const vid = getVisitorId();
  const sb = createClient();
  await sb.from('view_history').insert({ visitor_id: vid, saas_id: saasId, category });
}

export async function recommendedForVisitor(limit = 6) {
  const vid = getVisitorId();
  const sb = createClient();
  const { data: history } = await sb
    .from('view_history')
    .select('category')
    .eq('visitor_id', vid)
    .order('viewed_at', { ascending: false })
    .limit(20);
  const catCounts = new Map<string, number>();
  history?.forEach((r) => r.category && catCounts.set(r.category, (catCounts.get(r.category) ?? 0) + 1));
  const topCat = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!topCat) {
    const { data } = await sb
      .from('saas_projects')
      .select('id,slug,name,tagline,category,square_image_url')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(limit);
    return data ?? [];
  }
  const { data } = await sb
    .from('saas_projects')
    .select('id,slug,name,tagline,category,square_image_url')
    .eq('status', 'published')
    .eq('category', topCat)
    .limit(limit);
  return data ?? [];
}
