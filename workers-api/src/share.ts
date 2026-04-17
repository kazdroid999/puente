// share.ts — オーナー自発拡散機能
// シェア素材生成 / クリック計測 / コンバージョン記録
import { sb } from './supabase';
import type { Env } from './types';

const PLATFORMS = ['x', 'threads', 'facebook', 'linkedin', 'note', 'hatebu'] as const;
export type Platform = typeof PLATFORMS[number];

const SHARE_BASE = 'https://puente-saas.com';

// プリセットコピー生成
export function generateShareCopy(saas: { name: string; tagline: string; category: string; slug: string }) {
  const url = (ref: string) => `${SHARE_BASE}/apps/${saas.category}/${saas.slug}?ref=${ref}`;
  const tag = `#MicroSaaS #${saas.category} #PuenteMicroSaaS`;
  return {
    copy_x: `🚀 ${saas.name} を公開しました\n\n${saas.tagline}\n\n${url('{REF}')}\n${tag}`,
    copy_threads: `${saas.name} が Puente Micro SaaS Store に登場！\n${saas.tagline}\n→ ${url('{REF}')}`,
    copy_facebook: `${saas.name} を公開しました。\n\n${saas.tagline}\n\nアイデアから 3 日で SaaS に。Puente Micro SaaS Store にて公開中：\n${url('{REF}')}`,
    copy_linkedin: `New Micro SaaS launched: ${saas.name}\n\n${saas.tagline}\n\nBuilt in 3 days on Puente Micro SaaS Store.\n${url('{REF}')}\n${tag}`,
    copy_note: `# ${saas.name} を公開しました\n\n${saas.tagline}\n\nアイデアから 3 日で SaaS に。\n[サービスを見る](${url('{REF}')})`,
    hashtags: ['MicroSaaS', saas.category, 'PuenteMicroSaaS', 'AI', 'SaaS'],
    embed_html: `<iframe src="${SHARE_BASE}/embed/apps/${saas.slug}?ref={REF}" width="360" height="480" frameborder="0" loading="lazy"></iframe>`,
  };
}

// SaaS 公開時に呼ぶ：素材セットを upsert（動画 URL は別途 Cowork が更新）
export async function generateShareKit(env: Env, saasId: string) {
  const supa = sb(env);
  const { data: saas } = await supa
    .from('saas_projects')
    .select('id,name,tagline,category,slug')
    .eq('id', saasId)
    .single();
  if (!saas) throw new Error('saas not found');
  const copy = generateShareCopy(saas);
  await supa.from('share_kits').upsert({ saas_id: saasId, ...copy }, { onConflict: 'saas_id' });
  return { ok: true };
}

// 短縮シェア URL ジェネレータ（プラットフォーム別文言を REF 置換して返す）
export function buildShareUrl(saas: { category: string; slug: string }, refCompanyId: string, platform: Platform) {
  const u = new URL(`${SHARE_BASE}/apps/${saas.category}/${saas.slug}`);
  u.searchParams.set('ref', refCompanyId);
  u.searchParams.set('utm_source', platform);
  u.searchParams.set('utm_medium', 'owner_share');
  u.searchParams.set('utm_campaign', 'puente_micro_saas');
  return u.toString();
}

// クリック記録（ストア側 ?ref= 検出時に Worker に送信）
export async function recordShareClick(env: Env, payload: {
  saas_id: string;
  owner_company_id?: string;
  channel?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  visitor_id?: string;
  user_agent?: string;
  referer?: string;
}) {
  await sb(env).from('share_clicks').insert(payload);
  return { ok: true };
}

// サブスク webhook 処理時に呼ぶ：直近 30 日のクリックから紐付け
export async function attributeShareConversion(env: Env, opts: {
  saas_id: string;
  visitor_id?: string;
  stripe_subscription_id: string;
  amount_jpy: number;
}) {
  const supa = sb(env);
  if (!opts.visitor_id) return;
  const { data: lastClick } = await supa
    .from('share_clicks')
    .select('id, owner_company_id')
    .eq('saas_id', opts.saas_id)
    .eq('visitor_id', opts.visitor_id)
    .gte('created_at', new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (!lastClick?.owner_company_id) return;
  await supa.from('share_conversions').insert({
    saas_id: opts.saas_id,
    owner_company_id: lastClick.owner_company_id,
    click_id: lastClick.id,
    stripe_subscription_id: opts.stripe_subscription_id,
    amount_jpy: opts.amount_jpy,
  });
}
