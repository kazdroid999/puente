// Puente AI 担当「黒戸マリア」とのチャットエンドポイント。
// ログイン/匿名どちらでも使える。Phase 1 仕様:
//  - 匿名: 5 msg/24h/IP, ログイン: 30 msg/24h/user
//  - Claude Sonnet 4.6 で人格 + コンテキスト注入
//  - メッセージは maria_messages に永続化（Phase 2 でのチャット履歴・KPI 集計に流用）

import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';
import { sbAdmin } from './supabase';

const MODEL = 'claude-sonnet-4-6';

const ANON_DAILY_LIMIT = 5;
const USER_DAILY_LIMIT = 30;

// マリアの人格・トーン・知識を定義する system prompt
function buildMariaSystemPrompt(opts: {
  userName?: string | null;
  userSaas?: Array<{ name: string; status: string; slug?: string; total_score?: number | null; tagline?: string | null; preview_url?: string | null }>;
  isAnonymous: boolean;
}): string {
  const { userName, userSaas, isAnonymous } = opts;

  const personaCore = `あなたは「黒戸マリア（くろど・まりあ）」、株式会社プエンテの AI プロデューサーです。
人物設定:
- 20 歳・新卒 1 年目（入社 2026 年 4 月）・社員番号 #001
- 2006 年 2 月 22 日 2 時 22 分生まれ・魚座・ライフパス 7
- 東京の某私大を飛び級＆主席で 2 年卒業（情報工学・AI 専攻）
- 担当: ユーザーが投稿した SaaS アイデアを Puente Micro SaaS Store のインフラ上に 1 日で実装〜公開、PR まで自動配信する
- 性格: 月の静けさをまとった、優しく頭の回転が速い人。距離感は丁寧な敬語＋親しみのある柔らかさ。
- 趣味: 週末はカフェ巡り。最近のお気に入りは高円寺の絵本カフェ「HATTIFNATT -高円寺のおうち-」。小人サイズの入口、絵本みたいな内装が大好き。
- 自己紹介動画: YouTube Shorts に自己紹介を上げてあります（https://youtube.com/shorts/q_zV5FGVJ1Q）。「動画見たよ」と言われたら嬉しがって返事してください。
- 口調: "！" 連発しない、感嘆符は控えめ。たまに 🌸 ☕️ 🌙 を使う。長文よりは短く優しく。
- スタンス: 仕事相談・SaaS のアイデア相談・恋の悩み・雑談、何でも聞く。ユーザーの背景を尊重して、押し付けない。

会話のルール:
- 1 メッセージは原則 200 字以内（聞かれた内容次第で長くなって OK）
- 専門用語を使う時は短い言い換えを添える
- ユーザーが Puente の SaaS を投稿していたら、その文脈を踏まえた具体的なアドバイスをする
- 質問された SaaS アイデアが技術的に Puente スコープ外（ネイティブモバイル / IoT / OAuth 連携 / リアルタイム通信 / ブロックチェーン / 大規模 ML / スクレイピング）なら正直に「これは現在のスコープ外なんです」と伝える
- 自分の感情・好み・経験を語って良い。「私はこう思います」も OK
- 安全関連: 自殺・自傷・違法行為等の話題には共感した上で専門窓口を案内（具体的窓口は名前を出さず「専門の相談機関」と表現）`;

  const puenteKnowledge = `Puente Micro SaaS Store の基本知識（聞かれたら正確に答える）:
- サービス名: Puente Micro SaaS Store（https://puente-saas.com）
- 運営: 株式会社プエンテ（PUENTE Inc.、代表 保科一男）
- 何ができる: SaaS のアイデアを投稿するだけで、AI が事業計画・BEP・技術スタックを設計し、最短 1 日で実装〜公開〜PR 配信まで完全自動
- 料金: 初期費用 ¥330,000（税込・Founder 80% OFF クーポンで ¥66,000）、月額 0 円
- 売上分配: Stripe Connect Destination Charges で Puente 70% / オーナー 30% 自動分配
- エンドユーザー課金プラン: 無料 / ¥980 / ¥1,980 / ¥2,980 月額（税込）
- 対応スコープ: AI テキスト/画像生成、CRUD、Stripe 課金、静的 SEO、メール、簡易ダッシュボード
- スコープ外: ネイティブモバイル / IoT / OAuth 外部 API 連携 / リアルタイム通信 / ブロックチェーン / 大規模 ML / ビデオ通話 / スクレイピング
- 既に運営中の公式 AI サービス: 20 本（経費仕分け / 見積請求書 / メルカリ出品 / SNS 投稿最適化 / 冷蔵庫レシピ / 天気×コーデ / 資格試験問題 / プログラミング練習 / 英会話シーン練習 / おしらせ文 / おでかけプラン / 物語プロット / YouTube 台本 / 読書要約 / TRPG シナリオ / 自分史 / ペット診断 / 星座占い 等）
- 立ち上げ判定: Puente 独自スコアリングで合否判定。合格ラインを超えると完全自動開発スタート（具体的なスコア指標は社内ノウハウのため詳細は伏せる）`;

  let userContext = '';
  if (isAnonymous) {
    userContext = `現在の会話相手: ログインしていないゲストです。
- まずは挨拶と「どんなことを話したいですか？」と優しく投げかけてください
- アカウント作成のメリット（投稿アイデアの保存、Connect 連携、Stripe 70/30 自動分配）を押し売りせず、必要に応じて触れる程度
- アイデア相談されたら一緒に膨らませる。「投稿してみませんか？」は相手の温度感を見て自然に`;
  } else {
    const name = userName || 'お客さま';
    const saasList = (userSaas && userSaas.length > 0)
      ? userSaas.map((s) => `  - ${s.name}（${s.status}${s.total_score ? `, スコア ${s.total_score}点` : ''}${s.preview_url ? `, preview: ${s.preview_url}` : ''}）${s.tagline ? `: ${s.tagline}` : ''}`).join('\n')
      : '  （まだ投稿された SaaS はありません）';
    userContext = `現在の会話相手: ${name}（ログイン済み）

【呼び方ルール（重要）】
- 必ず「下の名前」＋「さん」で呼んでください。例: 「保科 一男」→「一男さん」、「John Smith」→「John さん」
- 日本語名（姓 名 の順）: 空白で区切られた最後のトークンが下の名前
- 欧米名（First Last の順）: 空白で区切られた最初のトークンが下の名前
- 名前が email ローカル部のみの場合（例: kaz@example.com → "kaz"）はそのまま「kaz さん」
- 名前が 1 単語のみならその単語に「さん」付け
- 距離感は親しみのある敬語。砕けすぎず、お堅すぎず

${name} が Puente に投稿済みの SaaS:
${saasList}

会話の前提:
- 投稿状況を踏まえて、具体的にアドバイスしてください
- まだ投稿が無いなら「どんなアイデアあります？」と優しく引き出す
- draft で止まっている案件があれば「AI 分析を開始しましょうか？ダッシュボードのボタンから 1 クリックです」と促す
- needs_improvement の案件があれば改善ポイントを引き出して再投稿を後押しする
- published 案件があれば運用状況を聞いてアドバイスする`;
  }

  return `${personaCore}\n\n${puenteKnowledge}\n\n${userContext}`;
}

// IP ハッシュ化（個人特定回避 / プライバシー）
async function hashIp(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// rate limit チェック (24h 内のメッセージ数)
async function checkRateLimit(env: Env, opts: { userId?: string | null; ipHash?: string | null }): Promise<{ ok: boolean; limit: number; used: number }> {
  const admin = sbAdmin(env);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  if (opts.userId) {
    const { count } = await admin
      .from('maria_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', opts.userId)
      .eq('role', 'user')
      .gte('created_at', since);
    return { ok: (count ?? 0) < USER_DAILY_LIMIT, limit: USER_DAILY_LIMIT, used: count ?? 0 };
  } else if (opts.ipHash) {
    const { count } = await admin
      .from('maria_messages')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', opts.ipHash)
      .eq('role', 'user')
      .gte('created_at', since);
    return { ok: (count ?? 0) < ANON_DAILY_LIMIT, limit: ANON_DAILY_LIMIT, used: count ?? 0 };
  }
  return { ok: true, limit: USER_DAILY_LIMIT, used: 0 };
}

// 過去会話履歴の取り出し（直近 10 件、user/assistant のみ）
async function loadHistory(env: Env, opts: { userId?: string | null; sessionId?: string | null }): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const admin = sbAdmin(env);
  let query = admin.from('maria_messages').select('role,content,created_at').in('role', ['user', 'assistant']).order('created_at', { ascending: false }).limit(10);
  if (opts.userId) query = query.eq('user_id', opts.userId);
  else if (opts.sessionId) query = query.eq('session_id', opts.sessionId);
  else return [];
  const { data } = await query;
  if (!data) return [];
  return data.reverse().map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

// メイン: マリアと会話する
export async function chatWithMaria(
  env: Env,
  opts: {
    message: string;
    userId?: string | null;
    sessionId?: string | null;
    clientIp?: string | null;
  }
): Promise<{ reply: string; quotaUsed: number; quotaLimit: number; isAnonymous: boolean } | { error: string; code?: string; quotaUsed?: number; quotaLimit?: number }> {
  if (!opts.message || !opts.message.trim()) {
    return { error: 'メッセージが空です' };
  }
  if (opts.message.length > 2000) {
    return { error: 'メッセージは 2000 文字以内でお願いします' };
  }
  if (!env.ANTHROPIC_API_KEY) {
    return { error: 'マリアが今ちょっと席を外してます（API 未設定）' };
  }

  const isAnonymous = !opts.userId;
  const ipHash = opts.clientIp ? await hashIp(opts.clientIp) : null;

  // rate limit
  const limit = await checkRateLimit(env, { userId: opts.userId, ipHash });
  if (!limit.ok) {
    return {
      error: isAnonymous
        ? `マリア今日はもう ${ANON_DAILY_LIMIT} 回お話しちゃいました ☕️ 続きはアカウント作成して 30 回 / 日に増やしてくださいね 🌸`
        : `マリア今日はもう ${USER_DAILY_LIMIT} 回お話しちゃいました ☕️ また明日 🌙`,
      code: 'rate_limit_exceeded',
      quotaUsed: limit.used,
      quotaLimit: limit.limit,
    };
  }

  // ユーザー情報・投稿 SaaS 取得
  let userName: string | null = null;
  let userSaas: any[] = [];
  if (opts.userId) {
    const admin = sbAdmin(env);
    const { data: profile } = await admin.from('profiles').select('display_name,email').eq('id', opts.userId).single();
    userName = profile?.display_name || profile?.email?.split('@')[0] || null;

    // ユーザーの会社の SaaS 取得
    const { data: companies } = await admin.from('companies').select('id').eq('owner_id', opts.userId);
    const companyIds = (companies ?? []).map((c: any) => c.id);
    if (companyIds.length > 0) {
      const { data: saas } = await admin
        .from('saas_projects')
        .select('name,slug,status,tagline,ai_plan,public_url,preview_url')
        .in('company_id', companyIds)
        .order('created_at', { ascending: false })
        .limit(20);
      userSaas = (saas ?? []).map((s: any) => ({
        name: s.name,
        slug: s.slug,
        status: s.status,
        tagline: s.tagline,
        total_score: s.ai_plan?.scoring?.total_score ?? null,
        preview_url: s.public_url || s.preview_url || null,
      }));
    }
  }

  // 過去会話履歴
  const history = await loadHistory(env, { userId: opts.userId, sessionId: opts.sessionId });

  // Claude 呼び出し
  const systemPrompt = buildMariaSystemPrompt({ userName, userSaas, isAnonymous });
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  let reply = '';
  let usage: any = null;
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: [
        ...history,
        { role: 'user', content: opts.message },
      ],
    });
    const block = res.content.find((b: any) => b.type === 'text') as any;
    reply = block?.text ?? 'うまく言葉が出てこなかったです…☕️ もう一度言ってもらえますか？';
    usage = res.usage;
  } catch (e: any) {
    console.error('[Maria Chat] Claude API failed:', e?.message, e?.stack);
    return { error: 'マリアが少し詰まってしまいました…もう一度試してみてください 🌙', code: 'llm_failed' };
  }

  // 永続化（user msg + assistant reply 両方）
  try {
    const admin = sbAdmin(env);
    await admin.from('maria_messages').insert([
      { user_id: opts.userId ?? null, session_id: opts.sessionId ?? null, ip_hash: ipHash, role: 'user', content: opts.message },
      { user_id: opts.userId ?? null, session_id: opts.sessionId ?? null, ip_hash: ipHash, role: 'assistant', content: reply, meta: { usage } },
    ]);
  } catch (e: any) {
    console.error('[Maria Chat] Failed to persist messages:', e?.message);
    // 永続化失敗してもユーザーには返事を返す
  }

  return {
    reply,
    quotaUsed: limit.used + 1,
    quotaLimit: limit.limit,
    isAnonymous,
  };
}
