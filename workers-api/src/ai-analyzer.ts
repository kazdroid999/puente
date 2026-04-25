// Punete Micro SaaS Store — AI 企画解析エンジン (Anthropic Claude)
// brief (jsonb) → ai_plan (jsonb: 事業計画 + BEP + 技術スタック + 3日ロードマップ + スコアリング)
//
// ★ 3段階判定基準:
//   total_score >= 85 → auto_dev（自動開発トリガー）
//   60 <= total_score < 85 → needs_improvement（改善提案をユーザーに返す）
//   total_score < 60 → rejected（却下）
//
// ★ 技術スコープ制限:
//   OK: CRUD, フォーム, AI文章/画像生成, Stripe課金
//   NG: 外部API連携(OAuth), リアルタイム通信(WebSocket), ネイティブアプリ, ハードウェア連携

import Anthropic from '@anthropic-ai/sdk';
import type { Env, SaasBrief, AiPlan } from './types';
import { sb, sbAdmin } from './supabase';
import { runAutoDev } from './auto-dev';
import { SCORING_RUBRIC, SCORING_RUBRIC_VERSION } from './scoring-rubric';

// Phase 2 自己改善ループ: 類似 published SaaS の直近 KPI を system prompt に RAG 注入。
// fetch_similar_published_saas RPC で DB から直接引く。
// データが無い/エラーの場合は空文字を返し、フォールバックで現行通り動作。
async function fetchSimilarCasesPrompt(env: Env, brief: SaasBrief): Promise<string> {
  try {
    const s = sbAdmin(env);
    const { data, error } = await s.rpc('fetch_similar_published_saas', {
      p_category: brief.category ?? null,
      p_tam_min: null,
      p_tam_max: null,
      p_limit: 5,
    });
    if (error || !data || data.length === 0) return '';
    const lines = (data as any[]).map((c: any) => {
      const conv = c.conversion_rate != null ? `${(c.conversion_rate * 100).toFixed(1)}%` : 'N/A';
      const ret = c.retention_30d != null ? `${(c.retention_30d * 100).toFixed(1)}%` : 'N/A';
      const mrr = c.mrr_jpy != null ? `¥${Number(c.mrr_jpy).toLocaleString()}` : 'N/A';
      const users = c.active_users != null ? `${c.active_users}人` : 'N/A';
      return `- [${c.name}] category=${c.category}, conversion=${conv}, retention30d=${ret}, MRR=${mrr}, active_users=${users}`;
    }).join('\n');
    return `

## 類似過去事例（同カテゴリの public SaaS 実績）
以下は本企画と同カテゴリで public 公開されている既存 SaaS の直近 KPI 実績です。
本企画を評価する際、これらと比較して「より高いスコアをつけるに値するか」を相対的に判定してください。
${lines}

これらの実績データを踏まえて、本企画が同カテゴリの既存事例より成功確率が高いと判断できる場合は
profitability を重点的に評価し、逆に既存事例を下回る見込みなら改善提案でその差分を示してください。
`;
  } catch (e) {
    console.error('[AI Analyzer] fetchSimilarCasesPrompt failed (non-fatal):', e);
    return '';
  }
}

const AUTO_DEV_THRESHOLD = 85;    // 自動開発トリガー
const IMPROVEMENT_THRESHOLD = 60; // 改善提案ライン（60〜84は needs_improvement）
// < 60 は rejected

const SYSTEM_PROMPT = `あなたは日本のSaaS事業立ち上げに特化したプロダクトストラテジスト兼シニアソフトウェアアーキテクトです。
株式会社プエンテが運営する Punete Micro SaaS Store では、ユーザーから投稿された企画を 3 日以内にローンチ可能な Micro SaaS に転換します。

## 技術スタック（固定）
- Frontend: Cloudflare Pages (HTML/JS or Next.js)
- Backend: Cloudflare Workers (Hono)
- DB: Supabase Postgres (RLS)
- Auth: Supabase Auth
- Payments: Stripe (Destination Charges / Connect)
- AI: Anthropic Claude API (文章生成) / OpenAI DALL-E (画像生成)
- Hosting: Cloudflare

## ★ 対応可能・不可能リスト（スコープ判定用）

**対応可能（scope_ok=true）:**
- CRUD操作
- フォーム入力・バリデーション
- AI文章生成（Claude API） / AI画像生成（DALL-E）
- Stripe決済（サブスク・一括）
- メール通知（Resend）
- 静的コンテンツ表示
- ファイルアップロード（Cloudflare R2）
- 簡易的なダッシュボード・レポート

**対応不可（scope_ok=false）:**
- OAuth認証が必要な外部API連携（Google / Slack / Notion / LINE API 等）
- リアルタイム通信（WebSocket, SSE, チャット）
- ネイティブモバイルアプリ
- ハードウェア・IoT連携
- ブロックチェーン・暗号通貨
- 大規模データ処理・ML トレーニング
- ビデオ通話・音声通話
- スクレイピング・クローリング

---

${SCORING_RUBRIC}

---

## 出力規律（追加）

出力は必ず JSON のみ。日本語で書く。マーケット規模 (TAM) は国内市場で現実的な数字。
BEP は月次固定費・平均ARPU・損益分岐MRR・損益分岐ユーザー数を JPY で算出。
roadmap_3day は Day1/2/3 で deployable な状態に到達する具体的タスク。`;

// Anthropic API の一時的エラー (429 / 5xx / network) を指数バックオフで retry。
// 4xx (validation) は即 throw、retry しても直らない。
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const status: number | undefined = e?.status ?? e?.response?.status;
      // 4xx は retry 不可（リクエスト側の問題）、ただし 408/429 だけは retry
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) {
        throw e;
      }
      if (i === attempts - 1) break;
      const delay = Math.min(1000 * Math.pow(2, i), 8000);
      console.warn(`[AI Analyzer:${label}] retry ${i + 1}/${attempts} after ${delay}ms:`, e?.message ?? e);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function analyzeBrief(env: Env, saasId: string, brief: SaasBrief): Promise<AiPlan> {
  console.log(`[AI Analyzer] Starting analysis for saas_id=${saasId}`);

  if (!env.ANTHROPIC_API_KEY) {
    console.error('[AI Analyzer] ANTHROPIC_API_KEY is not set!');
    // 設定欠如は即 draft に戻す (詰まり防止)
    try { await sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', saasId); } catch {}
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  await sbAdmin(env).from('saas_projects').update({ status: 'ai_analyzing' }).eq('id', saasId);
  console.log(`[AI Analyzer] Status updated to ai_analyzing for ${saasId}`);

  // 以下、ai_analyzing で詰まらないように全体を try/catch で包む。
  // どんな例外でも status='draft' に戻して再投稿できる状態に回復する。
  let messageOuter: any;
  try {
  // Phase 2 RAG: 同カテゴリの直近 published SaaS 実績を system prompt に注入
  const similarCasesPrompt = await fetchSimilarCasesPrompt(env, brief);

  const message = await withRetry('messages.create', () => client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT + similarCasesPrompt,
    messages: [
      {
        role: 'user',
        content: `以下の企画を解析し、指定スキーマの JSON のみを返してください。

# 企画
\`\`\`json
${JSON.stringify(brief, null, 2)}
\`\`\`

# 出力スキーマ (JSON)
{
  "executive_summary": string (200字以内),
  "target_market": { "persona": string, "pain": string, "tam_jpy": number },
  "core_features": [{ "name": string, "description": string, "priority": "P0"|"P1"|"P2" }],
  "tech_stack": { "frontend": string, "backend": string, "db": string, "hosting": string, "auth": string, "payments": string },
  "scope_check": {
    "scope_ok": boolean,
    "out_of_scope_features": string[],
    "alternatives": string[]
  },
  "bep": { "monthly_fixed_cost_jpy": number, "avg_arpu_jpy": number, "break_even_mrr_jpy": number, "break_even_users": number },
  "risks": string[],
  "kpis": string[],
  "roadmap_3day": [
    { "day": 1, "tasks": string[] },
    { "day": 2, "tasks": string[] },
    { "day": 3, "tasks": string[] }
  ],
  "scoring": {
    "feasibility": { "score": number, "reason": string },
    "profitability": { "score": number, "reason": string },
    "technical_difficulty": { "score": number, "reason": string },
    "total_score": number
  },
  "decision": "auto_dev" | "needs_improvement" | "rejected",
  "improvement_suggestions": string[] | null,
  "rejection_reason": string | null
}`,
      },
    ],
  }));
  messageOuter = message;

  console.log(`[AI Analyzer] Claude API response received for ${saasId}, stop_reason=${message.stop_reason}`);

  const text = message.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`[AI Analyzer] No JSON in response for ${saasId}:`, text.slice(0, 500));
    await sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', saasId);
    throw new Error('AI returned no JSON');
  }
  let plan: AiPlan;
  try {
    plan = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error(`[AI Analyzer] JSON parse failed for ${saasId}:`, (parseErr as Error).message);
    await sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', saasId);
    throw new Error(`AI returned invalid JSON: ${(parseErr as Error).message}`);
  }

  // ===== 3段階判定ロジック =====
  const totalScore = plan.scoring?.total_score ?? 0;
  const scopeOk = plan.scope_check?.scope_ok !== false; // undefined or true → OK

  let newStatus: string;

  if (totalScore >= AUTO_DEV_THRESHOLD && scopeOk) {
    // ★ 85点以上 & スコープOK → 自動開発トリガー
    newStatus = 'auto_dev';
    plan.decision = 'auto_dev';
    console.log(`[AI Analyzer] ${saasId}: AUTO_DEV (score=${totalScore}, scope_ok=${scopeOk})`);
  } else if (totalScore >= IMPROVEMENT_THRESHOLD) {
    // 60〜84点、またはスコープ外 → 改善提案
    newStatus = 'needs_improvement';
    plan.decision = 'needs_improvement';
    console.log(`[AI Analyzer] ${saasId}: NEEDS_IMPROVEMENT (score=${totalScore}, scope_ok=${scopeOk})`);
  } else {
    // 60点未満 → 却下
    newStatus = 'rejected';
    plan.decision = 'rejected';
    console.log(`[AI Analyzer] ${saasId}: REJECTED (score=${totalScore})`);
  }

  // スコープ外なのに auto_dev にならないよう二重チェック
  if (!scopeOk && newStatus === 'auto_dev') {
    newStatus = 'needs_improvement';
    plan.decision = 'needs_improvement';
  }

  const { error: updateErr } = await sbAdmin(env)
    .from('saas_projects')
    .update({
      ai_plan: plan,
      status: newStatus,
    })
    .eq('id', saasId);
  if (updateErr) {
    console.error(`[AI Analyzer] Failed to update saas_project ${saasId}:`, updateErr.message);
  } else {
    console.log(`[AI Analyzer] Updated ${saasId} → status=${newStatus}, total_score=${totalScore}`);
  }

  // ===== auto_dev → 自動SaaS生成パイプライン =====
  if (newStatus === 'auto_dev') {
    try {
      // Get owner_id from company → profiles
      const { data: project } = await sbAdmin(env)
        .from('saas_projects')
        .select('company_id, companies(owner_id)')
        .eq('id', saasId)
        .single();
      const ownerId = (project as any)?.companies?.owner_id || (project as any)?.company_id;

      if (ownerId) {
        console.log(`[AI Analyzer] Triggering auto-dev pipeline for ${saasId}, owner=${ownerId}`);
        const result = await runAutoDev(env, saasId, brief, plan, ownerId);
        console.log(`[AI Analyzer] Auto-dev complete: slug=${result.slug}, preview=${result.preview_url}`);

        // SNSプロモーションキューに自動登録
        const channels = ['prtimes', 'wix_blog', 'x', 'instagram', 'youtube_short'] as const;
        for (const channel of channels) {
          try {
            await sbAdmin(env).from('promo_posts').insert({
              saas_id: saasId,
              channel,
              payload: {
                name: brief.name,
                summary: plan.executive_summary,
                category: brief.category,
                features: plan.core_features?.slice(0, 3).map(f => f.name) || [],
                app_url: result.preview_url,
              },
              status: 'queued',
            });
          } catch {} // non-blocking
        }
      } else {
        console.error(`[AI Analyzer] Cannot find owner for project ${saasId}, skipping auto-dev`);
        await sbAdmin(env).from('saas_projects').update({ status: 'pending_approval' }).eq('id', saasId);
      }
    } catch (autoDevErr) {
      console.error(`[AI Analyzer] Auto-dev pipeline failed for ${saasId}:`, (autoDevErr as Error).message);
      // Fallback: set to pending_approval for manual review
      await sbAdmin(env).from('saas_projects').update({ status: 'pending_approval' }).eq('id', saasId);
    }
  }

  return plan;
  } catch (err) {
    // ai_analyzing で詰まらないように、すべての例外で status='draft' にロールバック。
    // ユーザーは UI から再投稿可能になる。message-level の細かいエラーは内部 catch で
    // すでに draft に戻している場合があるが、二重 update は冪等なので問題なし。
    console.error(`[AI Analyzer] FATAL for ${saasId}, rolling back to draft:`, (err as Error)?.message ?? err);
    try {
      await sbAdmin(env).from('saas_projects').update({ status: 'draft' }).eq('id', saasId);
    } catch (rollbackErr) {
      console.error(`[AI Analyzer] Rollback failed for ${saasId}:`, rollbackErr);
    }
    throw err;
  }
}
