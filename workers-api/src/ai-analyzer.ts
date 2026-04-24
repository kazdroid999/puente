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

export async function analyzeBrief(env: Env, saasId: string, brief: SaasBrief): Promise<AiPlan> {
  console.log(`[AI Analyzer] Starting analysis for saas_id=${saasId}`);

  if (!env.ANTHROPIC_API_KEY) {
    console.error('[AI Analyzer] ANTHROPIC_API_KEY is not set!');
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  await sbAdmin(env).from('saas_projects').update({ status: 'ai_analyzing' }).eq('id', saasId);
  console.log(`[AI Analyzer] Status updated to ai_analyzing for ${saasId}`);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
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
  });

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
}
