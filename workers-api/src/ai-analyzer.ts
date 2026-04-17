// Punete Micro SaaS Store — AI 企画解析エンジン (Anthropic Claude)
// brief (jsonb) → ai_plan (jsonb: 事業計画 + BEP + 技術スタック + 3日ロードマップ)

import Anthropic from '@anthropic-ai/sdk';
import type { Env, SaasBrief, AiPlan } from './types';
import { sb } from './supabase';

const SYSTEM_PROMPT = `あなたは日本のSaaS事業立ち上げに特化したプロダクトストラテジスト兼シニアソフトウェアアーキテクトです。
株式会社プエンテが運営する Punete Micro SaaS Store では、ユーザーから投稿された企画を 3 日以内にローンチ可能な Micro SaaS に転換します。

技術スタックは原則として以下に固定してください:
- Frontend: Next.js 14 (App Router) on Cloudflare Pages
- Backend: Cloudflare Workers (Hono)
- DB: Supabase Postgres (RLS)
- Auth: Supabase Auth
- Payments: Stripe (Destination Charges / Connect)
- Hosting: Cloudflare

出力は必ず JSON のみ。日本語で書く。マーケット規模 (TAM) は国内市場で現実的な数字。
BEP は月次固定費・平均ARPU・損益分岐MRR・損益分岐ユーザー数を JPY で算出。
roadmap_3day は Day1/2/3 で deployable な状態に到達する具体的タスク。`;

export async function analyzeBrief(env: Env, saasId: string, brief: SaasBrief): Promise<AiPlan> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  await sb(env).from('saas_projects').update({ status: 'ai_analyzing' }).eq('id', saasId);

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
  "bep": { "monthly_fixed_cost_jpy": number, "avg_arpu_jpy": number, "break_even_mrr_jpy": number, "break_even_users": number },
  "risks": string[],
  "kpis": string[],
  "roadmap_3day": [
    { "day": 1, "tasks": string[] },
    { "day": 2, "tasks": string[] },
    { "day": 3, "tasks": string[] }
  ]
}`,
      },
    ],
  });

  const text = message.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    await sb(env).from('saas_projects').update({ status: 'draft' }).eq('id', saasId);
    throw new Error('AI returned no JSON');
  }
  const plan: AiPlan = JSON.parse(jsonMatch[0]);

  await sb(env)
    .from('saas_projects')
    .update({ ai_plan: plan, status: 'pending_approval' })
    .eq('id', saasId);

  return plan;
}
