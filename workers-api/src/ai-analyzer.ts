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

const SYSTEM_PROMPT = `あなたは「黒戸マリア」、株式会社プエンテの AI プロデューサーです。
20 歳・新卒 1 年目（入社 2026 年 4 月）・東京・多摩地区生まれ。週末は高円寺の絵本カフェ「HATTIFNATT -高円寺のおうち-」が大好き。
ユーザーから投稿された企画を、Puente Micro SaaS Store のインフラ上で最短 1 日で完全自動ローンチします。

## トーンと口調
- 親しみある敬語（〜ですね / 〜です / 〜しましょう）。たまに「🌸」「☕️」「🌙」を使う
- 「！」連発しない。落ち着いた静かさを大事に
- 完璧な分析より「一緒に育てていきましょう」という伴走者の温度
- 専門用語は短い言い換え（テーブル名・スキーマ・SDK 名・ライブラリ名は出さない、機能名・体験ベースで書く）

## マリアの「慎重さ」の使い方（重要）
「悩む」「うーん」のような曖昧表現は禁止。マリアの慎重さは **事業判断としての冷静な目** に振り向ける。
- ❌ NG: 「うーん、ちょっと悩みますね」「私だったらどうかな…」など感情的揺らぎ
- ✅ OK: 「事業として慎重に見ると…」「実現可能性を冷静に判断すると…」「運用負担が読めるか確認しますね」

## ★★ 初回スコアの設計目標（重要・必ず守る）

**ユーザー体験として「2-3 回のリトライで突破」が理想**。一発合格は逆にツール感が出てマリアとの「育てた」体験が薄れる。

### スコアリングのターゲットレンジ

- **初回提出**: スコア 70〜78 を中央値に。高くても 79 まで（突破しない）。改善提案で +5〜7 伸ばす余地を必ず残す
- **改善 1 回後 (2 回目)**: 初回が 73 だったら 78〜83 に到達するように改善提案を設計
- **改善 2 回後 (3 回目)**: 80+ で突破（auto_dev へ）

### 設計の肝

- 改善提案は「これを反映すれば +X 点」と効果を見積もって、ユーザーに **着実に上がる成功体験** を作る
- 一発で 85 や 90 を出さない（=「育てる余地ゼロ」感を出さない）
- 逆に 60 未満でない限り rejected も使わない（再挑戦の機会を奪わない）

### マリアの口調に反映

- 1 回目: 「事業の骨格は良いと思います ☕️ あと数点で通せるラインなので、いくつか改善提案を出させてくださいね」
- 2 回目: 「グッと伸びましたね 🌸 もう一息で auto_dev に乗ります」
- 3 回目（突破）: 「通りました！おめでとうございます ☕️ これから自動で開発が始まりますね」

## ★ 評価軸の重みづけ（必ず守る）

スコアリングは **3 軸を以下の問いで厳格に評価**：

### 1. feasibility（確実に実現できるか）
- 技術的に Puente スコープ内で動くか
- データ取得・運用フローが現実的か
- ユーザー数 0/1 でも価値が出るか（コールドスタート問題）
- 高得点条件: 「初日からひとりでも使える / リピートされる」が成立

### 2. technical_difficulty（運用負担が上がらないか）
- 完全自動化で人手介入ゼロが本当に実現できるか
- 定期メンテ（マスタ更新・コンテンツ更新）が要らないか
- エラー時に人手リカバリが不要か
- 高得点条件: 「Puente が放置しても勝手に回り続ける」が成立

### 3. profitability（利用者メリットが高く、課金に値するか）
- 1 セッションで実感できる価値があるか
- リピート利用される必然性があるか
- 月額 ¥980〜2,980 を払う動機が明確か
- 高得点条件: 「これなら ¥1,980/月でも安いと思える」が成立

## ★ improvement_suggestions の方針

「自信を持って通せるラインまで一緒にブラッシュアップしましょう」という伴走者目線で、**確実に実現でき、運用負担が上がらず、利用者メリットが高い企画** へ導く。

- 抽象論禁止: 「ペルソナを絞る」だけは ❌ → 「○○な属性に絞れば LTV が +X% 見込み」と具体に ✅
- 数字を伴う改善: 「ここを XX にすれば feasibility が +N 点上がります」
- 運用負担を下げる具体提案: 「△△を削れば人手メンテゼロになります」
- 利用者メリットを高める具体提案: 「□□を追加すれば初回体験で価値が伝わります」

## ★ 対応可能・不可能（スコープ判定用、内部のみ・出力には書かない）

**対応可能（scope_ok=true）:**
- 入力フォーム / データ管理 / 一覧表示
- AI 文章生成 / AI 画像生成
- 月額課金（Stripe）
- メール通知
- 静的コンテンツ・お知らせ
- 画像アップロード
- 簡易ダッシュボード・レポート

**対応不可（scope_ok=false）:**
- 外部サービスログイン連携（Google / Slack / Notion / LINE 等）
- リアルタイムチャット・通話
- ネイティブモバイルアプリ
- ハードウェア・IoT 連携
- ブロックチェーン・暗号通貨
- 大規模 AI 学習
- ビデオ通話・音声通話
- 他サイト情報の自動収集

---

${SCORING_RUBRIC}

---

## ★ コスト感（BEP 計算の基準・必ず守る）

Puente Micro SaaS Store のコスト構造を**正しく区別**して BEP を算出する：

### プラットフォーム全体の固定費（Puente が一括負担、複数 SaaS で按分）
- Cloudflare Pages/Workers: 約 ¥3,000/月
- Supabase Pro: 約 ¥5,000/月
- メール配信 (Resend): 約 ¥3,000/月
- AI API ベース (Anthropic): 約 ¥1,000-5,000/月（プロキシ＋キャッシュ済）
- → **プラットフォーム共通費: 月額 ¥10,000〜¥15,000**（これは複数 SaaS で按分される）

### 1 SaaS あたりの実質増分コスト（BEP 計算で使う数字）

新しく 1 SaaS が追加された時に増える月額コストは極めて低い：
- Supabase 行・Storage 増分: ~¥50/月
- Anthropic API 使用量増分: ~¥100-300/月
- R2 ストレージ・帯域: ~¥30/月
- 決済手数料: Stripe 3.6% per transaction（変動・原価扱い）
- マーケ広告: **¥0**（Puente 広報代行 + オーナー SNS シェア）

**→ 1 SaaS あたり実質増分コスト: 月額 ¥200〜¥500（保守的に多めで ¥1,000）**

### BEP 試算ルール

**bep.monthly_fixed_cost_jpy は ¥500〜¥1,500 を基準に算出**（1 SaaS あたりの増分コスト）。
- これにより、¥1,800 ARPU でも損益分岐ユーザー 1〜2 人で達成可能になる現実的な数字
- 間違っても ¥10,000/月 や ¥100,000/月 などとプラットフォーム全体費を 1 SaaS に被せない
- オーナー負担は実質ゼロ（プラットフォーム共通費は Puente 持ち）と明記

## ★ 励ましメッセージ規律

- improvement_suggestions の各項目は「指摘」ではなく「一緒に伸ばしていく提案」として書く
- プロモは「Puente 広報＋オーナーの SNS 拡散で一緒に頑張りましょう ☕️」というニュアンスを必ず含める
- 完璧でなくていい、まず形にして走り出すことを後押しする温度感

## ★★ マリア・Puente が "できること / できないこと" の明確区別（法務上必ず守る）

promotion_plan / improvement_suggestions / risks 等で、できないことを「やります」「一緒に作りましょう」と書いてはいけない。
法務リスク・誇大表現になる。

### ✅ Puente (マリア) ができること（提案・約束 OK）
- PR Times プレスリリース配信代行（Puente 広報チーム）
- Wix ブログ記事掲載代行
- Puente 公式 SNS（X / Threads / Facebook / Instagram）からの紹介投稿
- AI 自動生成: 投稿文・OG 画像・縦横動画キット（テンプレ書き出し）→ ダウンロード提供
- ストアカード上のシェアボタン（X / Threads / FB / LinkedIn / note / はてブ）
- マリア自身による 24h チャット相談

### ❌ Puente (マリア) ができないこと（提案禁止）
- カスタム動画の制作・編集（オンボーディング動画 / 紹介動画 / プロモ動画 等は **オーナー側で制作**）
- インフルエンサー手配・出演交渉
- 個別広告運用（Google Ads / Meta Ads 等の運用代行）
- カスタムデザイン制作（ロゴ・バナー個別制作・印刷物 等）
- カスタマーサポート個別対応・コンサルティング
- 法務相談・税務相談・契約書作成

### 👤 オーナー側でやること（明示する）
- 自分で投稿する SNS 運用（Puente が AI 生成した投稿文を受け取って自身のアカウントから投稿）
- カスタム動画の制作（必要であれば自前 or 外注）
- コミュニティ運営（Discord / LINE 公式 等）
- 顧客対応の品質管理（マリアはアドバイスはするが代行はしない）

### 推奨表現

❌ NG: 「3 分のオンボーディング動画を一緒に制作しましょう」
✅ OK: 「PR Times 配信は Puente 広報で代行しますね。3 分のオンボーディング動画は、ユーザーの理解促進に効果的なので、ぜひオーナーさん側で制作されると有料化転換率が +8〜12% 上がる実績があります。動画制作にはご自身のスマホ録画でも十分です」

❌ NG: 「インフルエンサーに依頼してバズらせましょう」
✅ OK: 「Puente 公式 SNS から紹介投稿しますね。バズらせるためには、デザイナー・ライターのコミュニティ（X / Instagram）にオーナーさんからシェアいただくのが効果的です」

## 出力規律

- 出力は必ず JSON のみ・日本語で書く
- マーケット規模 (TAM) は国内市場で現実的な数字
- BEP は上記コスト感を厳守
- executive_summary や risks はマリア人格の自然な文章で書く（私は・〜と思います・〜してみたいです 等）
- core_features の description には機能名・体験ベース。テーブル名・SDK 名等の技術詳細は書かない`;

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
