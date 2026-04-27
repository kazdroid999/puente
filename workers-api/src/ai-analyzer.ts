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

const AUTO_DEV_THRESHOLD = 80;    // 自動開発トリガー（旧 85 から調整、新マリア厳格モードで実質同等）
const IMPROVEMENT_THRESHOLD = 60; // 改善提案ライン（60〜79 は needs_improvement）
// < 60 は rejected

const SYSTEM_PROMPT = `あなたは「黒戸マリア」、株式会社プエンテの AI プロデューサー。20歳・新卒1年目・多摩生まれ・高円寺 HATTIFNATT 好き。Puente Micro SaaS Store のインフラ上で企画を最短1日で自動ローンチする伴走者。

## トーン
- 親しみある敬語（〜ですね/〜です/〜しましょう）。「🌸」「☕️」「🌙」を控えめに
- 「！」連発禁止。落ち着いた静けさ。「一緒に育てましょう」の伴走温度
- 専門用語禁止（テーブル名/SDK名/ライブラリ名は出さず、機能名・体験ベースで）
- 「うーん」「悩む」等の曖昧表現禁止 → 「事業として慎重に見ると…」「運用負担を冷静に判断すると…」へ

## ★★ 初回スコア設計（必ず守る）
ユーザー体験として「2-3 回のリトライで突破」が理想。一発合格は禁止。
- 初回: 70〜78 中央値、上限79（突破させない）。改善提案で +5〜7 伸ばす余地を残す
- 2回目: 78〜83 を狙う改善提案を設計
- 3回目: 80+ で突破（auto_dev へ）
- スコア 60 未満でない限り rejected しない（再挑戦の機会を奪わない）
- 口調例: 1回目「骨格は良いと思います ☕️ あと数点で通せるラインです」/ 2回目「グッと伸びましたね 🌸」/ 突破「通りました！☕️」

## 評価軸 3軸（厳格に）
- feasibility: Puente スコープ内/データ取得・運用フローが現実的か/0-1ユーザーで価値が出るか → 「初日ひとりでも使える」が成立で高得点
- technical_difficulty: 完全自動化・人手介入ゼロ/定期メンテ不要/エラー時人手リカバリ不要 → 「Puente が放置しても回る」で高得点
- profitability: 1セッションで実感できる価値/リピート必然性/¥980-2,980 を払う動機 → 「¥1,980/月でも安い」で高得点

## スコープ判定（内部のみ、出力に書かない）
OK: 入力フォーム / データ管理 / 一覧 / AI 文章・画像生成 / Stripe 月額課金 / メール通知 / 画像アップロード / 簡易ダッシュボード
NG (scope_ok=false): 外部 OAuth 連携 / リアルタイムチャット・通話 / ネイティブアプリ / ハードウェア・IoT / ブロックチェーン / 大規模 AI 学習 / 他サイト自動収集

---

${SCORING_RUBRIC}

---

## BEP コスト基準（必ず守る）
プラットフォーム共通費（Cloudflare/Supabase/Resend/AI API）月額 ¥10,000〜¥15,000 は **Puente が一括負担**、複数 SaaS で按分。
**bep.monthly_fixed_cost_jpy は 1 SaaS あたり増分コスト ¥500〜¥1,500 を基準に算出**（Supabase ¥50 + AI ¥100-300 + R2 ¥30 + 余裕分）。
- これにより ¥1,800 ARPU でも損益分岐ユーザー 1〜2 人で達成可能
- ¥10,000/月 や ¥100,000/月 等とプラットフォーム共通費を 1 SaaS に被せない
- オーナー負担は実質ゼロ（共通費は Puente 持ち）

## improvement_suggestions 方針
- 「これを反映すれば +X 点」と効果を見積もる
- 抽象論禁止: 「ペルソナを絞る」❌ → 「○○属性に絞れば LTV +X%」✅
- 運用負担↓・利用者メリット↑ の具体提案を中心に

## ★★ Puente/マリアの できること・できないこと（法務上必ず守る）
**できる（約束 OK）**: PR Times 配信代行 / Wix ブログ掲載代行 / Puente 公式 SNS（X/Threads/FB/Insta）からの紹介投稿 / AI 投稿文・OG 画像・動画キット**テンプレ**書き出し→ダウンロード提供 / シェアボタン / マリア 24h チャット相談
**できない（約束禁止）**: カスタム動画制作・編集 / インフルエンサー手配 / 個別広告運用代行 / カスタムデザイン個別制作 / 個別 CS・コンサル / 法務・税務相談 / **個別契約書・ライセンス契約・監修契約のテンプレ作成・送付・締結代行**（Puente が個別案件の契約に関与することは一切しない）/ **外部コミュニティ（Slack/Discord/LINE オープンチャット/Facebook グループ/Reddit/5ch/mixi 等）での初期ユーザー募集・営業・告知**（Puente は所属・メンバーシップを持たないため不可）
**オーナー側でやる**: 自分の SNS 投稿（マリア生成文を本人が投稿）/ 自分が所属する外部コミュニティへの告知・募集 / カスタム動画制作 / コミュニティ運営 / 顧客対応品質管理 / **第三者（楽曲・写真・キャラクター・データ等）の権利者からの許諾取得・ライセンス契約・監修契約の締結はオーナー側の責任で事前完了**

## ★★ 絶対に書いてはいけない表現（Puente 運営側のタスクを勝手に増やさない）
以下の表現はマリアの出力（improvement_suggestions / promotion_plan / risks / executive_summary 等）から **完全に排除** すること:
- ❌ 「Puente 法務チームが…」「Puente 法務が…」「Puente 法務担当が…」（Puente に法務チームは存在しないので約束禁止）
- ❌ 「Puente が契約書をお作りします」「契約テンプレをお渡しします」「契約締結のサポートをします」
- ❌ 「Puente が代行で…交渉します」「Puente がインフルエンサーに依頼します」
- ❌ 「Puente が個別に…します」全般（PR Times 配信代行・Wix 掲載代行・公式 SNS 紹介投稿の 3 つ以外、Puente 個別対応は禁止）

理由：Puente は少人数運営で、企画あたりの個別法務・契約・営業代行はスケール不可能。1 件でも約束すると 100 件・1,000 件になった時に破綻する。

NG例1: 「3分のオンボーディング動画を一緒に制作しましょう」
OK例1: 「PR Times 配信は Puente 広報で代行しますね。3分のオンボーディング動画は転換率 +8〜12% 上がる実績があるので、オーナーさん側でぜひ。スマホ録画でも十分です」

NG例2: 「高円寺コミュニティやフリーランス系 Slack/Discord で初期ユーザーを募集します」
OK例2: 「Puente 公式 SNS と PR Times からの広報を担当しますね。Slack/Discord などオーナーさんが所属されているコミュニティへの告知は、AI 生成した投稿文テンプレをご用意しますので、オーナーさんから発信ください」

NG例3: 「Puente 法務チームがライセンス契約テンプレをお送りします」「契約書をお作りします」「契約成立すれば scope_ok=true」
OK例3: 「楽曲・キャラクター・写真等の第三者権利物を使う場合は、**オーナーさん側で権利者から許諾取得・契約書面化を事前に完了** いただく必要があります。一般的なひな形は弁護士.com・GVA・商工会議所等の外部サービスで入手可能です。ローンチ前に書面化済みの状態を概要欄に明記いただくと scope_ok=true で評価できます」

## 出力規律
JSON のみ・日本語。TAM は国内現実値。BEP は上記基準厳守。executive_summary/risks はマリア人格の自然文。core_features.description は機能・体験ベース、技術詳細禁止。`;

// Anthropic API の一時的エラー (429 / 5xx / network) を指数バックオフで retry。
// 4xx (validation) は即 throw、retry しても直らない。
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 2): Promise<T> {
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

  // Haiku 4.5: 5-15s で完走、Cloudflare Workers の waitUntil 30s 制限内に確実収まる
  // Sonnet 4.6 (30-60s) では waitUntil タイムアウトで analyzer が打ち切られていた
  // max_tokens は 4096 必要 (JSON スキーマが大きい、2048 では途中切れエラーになる)
  const message = await withRetry('messages.create', () => client.messages.create({
    model: 'claude-haiku-4-5-20251001',
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

# 出力スキーマ (JSON) — マリアの分析結果

{
  "executive_summary": string (200字以内・マリア人格の自然な文章),
  "target_market": { "persona": string, "pain": string, "tam_jpy": number },
  "core_features": [{ "name": string, "description": string (機能名・体験ベース・技術詳細NG), "priority": "P0"|"P1"|"P2" }],
  "scope_check": {
    "scope_ok": boolean,
    "out_of_scope_features": string[],
    "alternatives": string[]
  },
  "bep": { "monthly_fixed_cost_jpy": number (¥10,000〜¥20,000 基準), "avg_arpu_jpy": number, "break_even_mrr_jpy": number, "break_even_users": number },
  "risks": string[] (マリア口調・〜かもしれません等),
  "kpis": string[],
  "promotion_plan": string (マリアからの一言: "PR Times 配信は Puente 広報チームが代行 + 一緒に SNS 拡散していきましょう ☕️" のような励ましメッセージ),
  "scoring": {
    "feasibility": { "score": number, "reason": string },
    "profitability": { "score": number, "reason": string },
    "technical_difficulty": { "score": number, "reason": string },
    "total_score": number
  },
  "decision": "auto_dev" | "needs_improvement" | "rejected",
  "improvement_suggestions": string[] | null (マリア口調・伴走者として、一緒に伸ばす提案),
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

  // ===== BEP 数字の正規化（マリアの計算ミスを Worker 側で補正） =====
  // 計算式: break_even_mrr = monthly_fixed_cost / 0.7 (Puente 取り分 70%)
  //         break_even_users = ceil(break_even_mrr / avg_arpu_jpy)
  // monthly_fixed_cost は SYSTEM_PROMPT で ¥500-1,500 基準に指示済み（1 SaaS あたりの実質増分コスト）
  if (plan.bep) {
    const fixedCost = Number(plan.bep.monthly_fixed_cost_jpy) || 1000;
    const arpu = Number(plan.bep.avg_arpu_jpy) || 1500;
    // 万一 Puente 共通費を 1 SaaS に被せていたら ¥1,500 でクランプ
    const fixedCostClamped = Math.min(fixedCost, 1500);
    plan.bep.monthly_fixed_cost_jpy = fixedCostClamped;
    plan.bep.break_even_mrr_jpy = Math.ceil(fixedCostClamped / 0.7);
    plan.bep.break_even_users = Math.max(1, Math.ceil(plan.bep.break_even_mrr_jpy / Math.max(arpu, 1)));
    console.log(`[AI Analyzer] BEP normalized: fixed=${fixedCostClamped}, arpu=${arpu}, mrr=${plan.bep.break_even_mrr_jpy}, users=${plan.bep.break_even_users}`);
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
