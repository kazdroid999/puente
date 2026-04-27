// Punete Micro SaaS Store — Auto Dev Pipeline
// AI Plan (score >= 85 & scope_ok) → 自動的に SaaS アプリを生成・デプロイ
//
// 1. Claude API で prompt_template + input_schema を生成
// 2. saas_apps レコード作成
// 3. Cloudflare DNS CNAME 設定 ({slug}.puente-saas.com → puente-apps.pages.dev)
// 4. Stripe Product + 3 Prices 作成
// 5. saas_projects ステータスを preview に更新
// 6. ユーザーにプレビューリンク通知

import Anthropic from '@anthropic-ai/sdk';
import type { Env, AiPlan, SaasBrief } from './types';
import { sbAdmin } from './supabase';
import { stripeClient } from './stripe';

// ========== Slug Generation ==========
function generateSlug(name: string): string {
  // Japanese → romanized short slug
  const map: Record<string, string> = {
    'ファッション': 'fashion', 'コーデ': 'code', 'レシピ': 'recipe',
    'ビジネス': 'biz', 'マーケティング': 'marketing', '学習': 'learn',
    '資格': 'shikaku', '英語': 'english', '翻訳': 'translate',
    'メール': 'mail', 'ブログ': 'blog', '記事': 'article',
    'レポート': 'report', 'プレゼン': 'presen', '企画': 'plan',
    '提案': 'propose', 'デザイン': 'design', 'ロゴ': 'logo',
    '広告': 'ads', 'SNS': 'sns', '写真': 'photo',
    '動画': 'video', '音楽': 'music', 'ゲーム': 'game',
    '健康': 'health', '料理': 'cooking', '旅行': 'travel',
    '不動産': 'realestate', '法律': 'legal', '税金': 'tax',
    '会計': 'accounting', '人事': 'hr', '採用': 'recruit',
    '営業': 'sales', '契約': 'contract', '請求': 'invoice',
    'タスク': 'task', 'スケジュール': 'schedule', '日報': 'daily',
    'AI': 'ai', 'チャット': 'chat', '占い': 'uranai',
    'ダイエット': 'diet', 'フィットネス': 'fitness', '筋トレ': 'workout',
    'ペット': 'pet', '子育て': 'parenting', '教育': 'edu',
  };

  let slug = name.toLowerCase();
  // Try to extract meaningful keywords
  for (const [jp, en] of Object.entries(map)) {
    if (name.includes(jp)) {
      slug = en;
      break;
    }
  }

  // If still Japanese, create a hash-based slug
  if (/[^\x00-\x7F]/.test(slug)) {
    // Use first 8 chars of a simple hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    slug = 'app-' + Math.abs(hash).toString(36).slice(0, 6);
  }

  // ★ DNS-safe な slug に正規化:
  //   1) 英数字以外（空白・記号・全角等）を hyphen に
  //   2) 連続 hyphen を単一に
  //   3) 先頭末尾の hyphen を除去
  //   4) 最大 40 文字に切り詰め
  slug = slug
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  // 空文字フォールバック
  if (!slug) slug = 'app';

  // Append random suffix for uniqueness
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${slug}-${suffix}`;
}

// ========== Emoji + Color Selection ==========
const CATEGORY_STYLES: Record<string, { emoji: string; color: string }> = {
  business:      { emoji: '💼', color: '#2C3E50' },
  learning:      { emoji: '📚', color: '#8E44AD' },
  entertainment: { emoji: '🎮', color: '#E74C3C' },
  infra:         { emoji: '⚙️', color: '#34495E' },
  // fallbacks by keyword
  fashion:       { emoji: '👗', color: '#E91E63' },
  health:        { emoji: '💪', color: '#4CAF50' },
  food:          { emoji: '🍳', color: '#FF9800' },
  travel:        { emoji: '✈️', color: '#03A9F4' },
  finance:       { emoji: '💰', color: '#FFC107' },
  writing:       { emoji: '✍️', color: '#607D8B' },
  marketing:     { emoji: '📣', color: '#9C27B0' },
};

function pickStyle(category: string, name: string): { emoji: string; color: string } {
  // Check keywords in name first
  const nameL = name.toLowerCase();
  const kwMap: Record<string, string> = {
    'ファッション': 'fashion', 'コーデ': 'fashion', '服': 'fashion',
    '健康': 'health', 'ダイエット': 'health', 'フィットネス': 'health',
    '料理': 'food', 'レシピ': 'food', '食': 'food',
    '旅行': 'travel', '観光': 'travel',
    '投資': 'finance', '税': 'finance', '会計': 'finance',
    'ブログ': 'writing', '記事': 'writing', 'メール': 'writing', '文章': 'writing',
    'マーケ': 'marketing', '広告': 'marketing', 'SNS': 'marketing',
  };
  for (const [kw, cat] of Object.entries(kwMap)) {
    if (name.includes(kw)) {
      return CATEGORY_STYLES[cat] || CATEGORY_STYLES.business;
    }
  }
  return CATEGORY_STYLES[category] || CATEGORY_STYLES.business;
}

// ========== Claude API: Generate prompt_template + input_schema ==========
const APP_GEN_SYSTEM = `あなたはMicro SaaSアプリのプロンプトエンジニアです。
ユーザーの企画(ai_plan)に基づき、AIベースのWebアプリで使うprompt_templateとinput_schemaを設計してください。

## ルール
- prompt_template: Claude APIに渡すシステムプロンプト。{{key}} プレースホルダーでユーザー入力を埋め込む
- input_schema: ユーザーが入力するフォームの定義 (JSON配列)
- 出力は必ず markdown 形式 (output_format: "markdown")
- フォーム項目は3〜6個（多すぎない）
- select型は具体的なoptionsを5〜10個
- 日本語で設計

## input_schema の各項目
{ "key": string, "type": "text"|"textarea"|"select"|"number", "label": string, "options"?: string[], "required": boolean, "placeholder"?: string }

## prompt_template の書き方
- 最初にAIの役割を設定（例: "あなたは〜の専門家です"）
- {{key}} でユーザー入力を参照
- 出力フォーマットをMarkdownで指定（##見出し、箇条書き、表など）
- 最後にまとめ・アドバイスセクション

## 出力JSON
{
  "prompt_template": string,
  "input_schema": Array<{key,type,label,options?,required,placeholder?}>,
  "emoji": string (1文字の絵文字),
  "color": string (HEXカラーコード),
  "tagline": string (30文字以内のキャッチコピー),
  "example_output": string (200文字以内のサンプル出力概要)
}`;

async function generateAppConfig(
  env: Env,
  brief: SaasBrief,
  plan: AiPlan,
): Promise<{
  prompt_template: string;
  input_schema: any[];
  emoji: string;
  color: string;
  tagline: string;
  example_output: string;
}> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Haiku 4.5 で確実に waitUntil 30s 内に収める (Sonnet 4.6 は時間切れリスク)
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    system: APP_GEN_SYSTEM,
    messages: [
      {
        role: 'user',
        content: `以下のai_planに基づき、Micro SaaSアプリのprompt_template, input_schema, emoji, color, tagline, example_outputをJSON形式で返してください。

# 企画名
${brief.name}

# 概要
${plan.executive_summary}

# ターゲット
ペルソナ: ${plan.target_market?.persona || brief.target_users}
ペイン: ${plan.target_market?.pain || ''}

# コア機能
${plan.core_features?.map(f => `- [${f.priority}] ${f.name}: ${f.description}`).join('\n') || brief.features?.join('\n')}

# カテゴリ
${brief.category}

JSONのみを返してください。`,
      },
    ],
  });

  const text = message.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('[AutoDev] Claude returned no JSON for app config generation');
  }
  return JSON.parse(jsonMatch[0]);
}

// ========== Cloudflare Pages: Register custom domain ==========
// DNS wildcard CNAME *.puente-saas.com → CF proxied IPs handles resolution.
// But Cloudflare Pages requires each subdomain to be explicitly registered
// as a custom domain on the Pages project for routing to work (otherwise 522).
const CF_ACCOUNT_ID = '1406a3260412719d49e409e5d735dfdd';
const CF_PAGES_PROJECT = 'puente-apps';

async function setupSubdomainDNS(env: Env, subdomain: string): Promise<boolean> {
  const domain = `${subdomain}.puente-saas.com`;
  console.log(`[AutoDev] Registering Pages custom domain: ${domain}`);

  if (!env.CF_API_TOKEN) {
    console.warn('[AutoDev] CF_API_TOKEN not set — skipping Pages domain registration');
    return false;
  }

  try {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/${CF_PAGES_PROJECT}/domains`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CF_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      },
    );
    const result = await resp.json() as any;
    if (result.success) {
      console.log(`[AutoDev] Pages domain registered: ${domain} (status: ${result.result?.status})`);
      return true;
    } else {
      // Domain might already exist — check for duplicate error
      const errMsg = result.errors?.map((e: any) => e.message).join(', ') || 'unknown';
      if (errMsg.includes('already exists') || errMsg.includes('duplicate')) {
        console.log(`[AutoDev] Pages domain already exists: ${domain}`);
        return true;
      }
      console.error(`[AutoDev] Pages domain registration failed: ${errMsg}`);
      return false;
    }
  } catch (err) {
    console.error(`[AutoDev] Pages domain registration error:`, (err as Error).message);
    return false;
  }
}

// ========== Stripe: Create Product + 3 Prices ==========
async function createStripeProducts(
  env: Env,
  appName: string,
  appId: string,
): Promise<{ product_id: string; plans: any[] }> {
  const stripe = stripeClient(env);

  const product = await stripe.products.create({
    name: `[Micro SaaS] ${appName}`,
    metadata: { app_id: appId, source: 'auto_dev' },
  });

  const priceConfigs = [
    { key: 'free',     label: '無料',       price: 0,    limit: 5 },
    { key: 'basic',    label: 'ベーシック',  price: 980,  limit: 30 },
    { key: 'standard', label: 'スタンダード', price: 1980, limit: 100 },
    { key: 'premium',  label: 'プレミアム',  price: 2980, limit: -1 },
  ];

  const plans: any[] = [];
  for (const pc of priceConfigs) {
    if (pc.price === 0) {
      plans.push({ key: pc.key, label: pc.label, price: 0, limit: pc.limit, stripe_price_id: null });
      continue;
    }
    const stripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: pc.price,
      currency: 'jpy',
      recurring: { interval: 'month' },
      tax_behavior: 'inclusive',
      metadata: { app_id: appId, plan_key: pc.key },
    });
    plans.push({
      key: pc.key,
      label: pc.label,
      price: pc.price,
      limit: pc.limit,
      stripe_price_id: stripePrice.id,
    });
  }

  return { product_id: product.id, plans };
}

// ========== Phase Tracking (進捗表示) ==========
// マリアが頑張ってプログラミングしてる感を出す日本語フェーズ
const PHASES = {
  start:     { progress: 5,   phase: '📖 マリアが企画書を読み込み中…' },
  config:    { progress: 25,  phase: '✏️ マリアが画面の構成を考えてます' },
  building:  { progress: 50,  phase: '⌨️ マリアがプログラミング中…！' },
  deploying: { progress: 80,  phase: '🚀 マリアがデプロイ準備中' },
  done:      { progress: 100, phase: '✨ マリアが完成させました ☕️' },
} as const;

async function setPhase(
  s: ReturnType<typeof sbAdmin>,
  saasProjectId: string,
  key: keyof typeof PHASES,
): Promise<void> {
  const { progress, phase } = PHASES[key];
  // フェーズ更新は必ず非ブロッキング（失敗しても auto-dev 本体は止めない）
  try {
    await s.from('saas_projects').update({ dev_phase: phase, dev_progress: progress }).eq('id', saasProjectId);
  } catch (e) {
    console.warn('[AutoDev] setPhase failed (non-fatal):', (e as Error).message);
  }
}

// ========== Main: Auto Dev Pipeline ==========
export async function runAutoDev(
  env: Env,
  saasProjectId: string,
  brief: SaasBrief,
  plan: AiPlan,
  ownerId: string,
): Promise<{ app_id: string; slug: string; preview_url: string }> {
  const s = sbAdmin(env);

  console.log(`[AutoDev] Starting auto-dev for project=${saasProjectId}, name=${brief.name}`);

  // 開始: 開始時刻 + 初期フェーズ
  try {
    await s.from('saas_projects').update({
      dev_started_at: new Date().toISOString(),
      dev_phase: PHASES.start.phase,
      dev_progress: PHASES.start.progress,
    }).eq('id', saasProjectId);
  } catch (e) {
    console.warn('[AutoDev] dev_started_at init failed (non-fatal):', (e as Error).message);
  }

  // === Step 1: Generate app config via Claude ===
  console.log('[AutoDev] Step 1: Generating prompt_template + input_schema...');
  let appConfig: Awaited<ReturnType<typeof generateAppConfig>>;
  try {
    appConfig = await generateAppConfig(env, brief, plan);
  } catch (err) {
    console.error('[AutoDev] App config generation failed:', (err as Error).message);
    await s.from('saas_projects').update({ status: 'needs_improvement' }).eq('id', saasProjectId);
    throw err;
  }
  console.log('[AutoDev] App config generated successfully');
  await setPhase(s, saasProjectId, 'config');

  // === Step 2: Generate slug ===
  let slug = generateSlug(brief.name);
  // Ensure uniqueness
  const { data: existing } = await s.from('saas_apps').select('slug').eq('slug', slug).single();
  if (existing) {
    slug = slug + '-' + Math.random().toString(36).slice(2, 5);
  }
  const subdomain = slug;
  console.log(`[AutoDev] Slug: ${slug}, Subdomain: ${subdomain}`);

  // === Step 3: Pick style ===
  const style = pickStyle(brief.category, brief.name);
  const emoji = appConfig.emoji || style.emoji;
  const color = appConfig.color || style.color;

  // === Step 4: Insert saas_apps record ===
  console.log('[AutoDev] Step 4: Creating saas_apps record...');
  const usageLimits = { free: 5, basic: 30, standard: 100, premium: -1 };
  const defaultPlans = [
    { key: 'free', label: '無料', price: 0, limit: 5 },
    { key: 'basic', label: 'ベーシック', price: 980, limit: 30 },
    { key: 'standard', label: 'スタンダード', price: 1980, limit: 100 },
    { key: 'premium', label: 'プレミアム', price: 2980, limit: -1 },
  ];

  // idea_id references saas_ideas table — check if there's a linked idea
  const { data: linkedIdea } = await s
    .from('saas_ideas')
    .select('id')
    .eq('id', saasProjectId)
    .maybeSingle();

  const { data: newApp, error: insertErr } = await s
    .from('saas_apps')
    .insert({
      idea_id: linkedIdea?.id || null,   // FK → saas_ideas (nullable)
      owner_id: ownerId,
      slug,
      name: brief.name,
      description: plan.executive_summary || brief.overview,
      category: brief.category || 'business',
      subdomain,
      emoji,
      color,
      tagline: appConfig.tagline || brief.tagline || `${brief.name}をAIが自動生成`,
      prompt_template: appConfig.prompt_template,
      input_schema: appConfig.input_schema,
      output_format: 'markdown',
      usage_limits: usageLimits,
      plans: defaultPlans,
      example_output: appConfig.example_output || null,
      is_published: false,    // preview first
      is_official: false,     // user-submitted
    })
    .select('id,preview_token')
    .single();

  if (insertErr || !newApp) {
    console.error('[AutoDev] Failed to create saas_apps record:', insertErr?.message);
    await s.from('saas_projects').update({ status: 'needs_improvement' }).eq('id', saasProjectId);
    throw new Error(`Failed to create app: ${insertErr?.message}`);
  }
  const appId = newApp.id;
  const previewToken = newApp.preview_token;
  console.log(`[AutoDev] App created: id=${appId}, slug=${slug}`);
  await setPhase(s, saasProjectId, 'building');

  // === Step 5: Setup DNS ===
  console.log('[AutoDev] Step 5: Setting up DNS...');
  const dnsOk = await setupSubdomainDNS(env, subdomain);
  if (!dnsOk) {
    console.warn(`[AutoDev] DNS setup failed/skipped for ${subdomain} — will need manual setup`);
  }

  await setPhase(s, saasProjectId, 'deploying');

  // === Step 6: Create Stripe products ===
  console.log('[AutoDev] Step 6: Creating Stripe product + prices...');
  try {
    const { product_id, plans } = await createStripeProducts(env, brief.name, appId);
    // Update app with Stripe IDs and plan price IDs
    const plansWithStripe = plans.map(p => ({
      key: p.key,
      label: p.label,
      price: p.price,
      limit: p.limit,
      ...(p.stripe_price_id ? { stripe_price_id: p.stripe_price_id } : {}),
    }));
    await s.from('saas_apps').update({
      stripe_product_id: product_id,
      plans: plansWithStripe,
    }).eq('id', appId);
    console.log(`[AutoDev] Stripe product created: ${product_id}`);
  } catch (err) {
    console.error('[AutoDev] Stripe setup failed:', (err as Error).message);
    // Non-fatal — app still works on free plan
  }

  // === Step 7: Update saas_projects ===
  const previewUrl = `https://${subdomain}.puente-saas.com/?preview=${previewToken}`;
  await s.from('saas_projects').update({
    status: 'preview',
    preview_url: previewUrl,
    public_url: `https://${subdomain}.puente-saas.com`,
    slug,
    dev_phase: PHASES.done.phase,
    dev_progress: PHASES.done.progress,
  }).eq('id', saasProjectId);

  console.log(`[AutoDev] Pipeline complete! Preview: ${previewUrl}`);

  return { app_id: appId, slug, preview_url: previewUrl };
}
