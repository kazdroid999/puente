# Punete Micro SaaS Store — 本番QA結果

| 項目 | 値 |
|---|---|
| 実施日 | 2026-04-17 |
| 対象 | https://puente-saas.com (全6ドメイン + API) |
| 実施者 | Claude (CTO代行) |
| Commit | Direct Upload (Pages) / Workers API deployed |

---

## サマリ

| 区分 | Pass | Fail | Blocked | 備考 |
|---|---|---|---|---|
| インフラ / HTTPS | 6 | 0 | 0 | 全ドメイン 200 OK |
| API 認証制御 | 5 | 0 | 0 | |
| API エラーハンドリング | 3 | 2 | 0 | P0×1, P1×1 |
| セキュリティヘッダ | 2 | 4 | 0 | HSTS/CSP/X-Frame 欠如 |
| CORS | 0 | 1 | 0 | **P0** |
| Supabase RLS | 17 | 0 | 0 | 全テーブル RLS ON |
| Supabase SECURITY DEFINER | 4 | 0 | 0 | |
| Supabase Advisors | — | — | — | 既存警告あり (cowork 系, 別案件) |
| Stripe 連携 | 2 | 0 | 1 | checkout は saas_plans 未登録のため Blocked |
| LP / UI | 8 | 1 | 0 | テキスト重複バグ |
| シークレット露出 | 3 | 0 | 0 | LP/apps/dashboard ソースにキー露出なし |
| **合計** | **50** | **8** | **1** | |

---

## P0 バグ（即日対応必須）

### P0-001: CORS — 任意オリジンにクレデンシャル付き許可

- **エンドポイント**: `api.puente-saas.com` 全 `/api/*` パス
- **現象**: `Origin: https://evil.com` を送ると `Access-Control-Allow-Origin: https://evil.com` + `Access-Control-Allow-Credentials: true` が返る
- **攻撃ベクタ**: 攻撃者が任意サイトから被害者のブラウザ経由で認証付き API リクエストを送信可能（CSRF/データ窃取）
- **原因**: `workers-api/src/index.ts` L23 — `origin: (origin) => origin` が全 origin をエコーバック
- **修正案**:
  ```typescript
  const ALLOWED_ORIGINS = [
    'https://puente-saas.com',
    'https://www.puente-saas.com',
    'https://apps.puente-saas.com',
    'https://dashboard.puente-saas.com',
    'https://admin.puente-saas.com',
  ];
  app.use('/api/*', cors({
    origin: (origin) => ALLOWED_ORIGINS.includes(origin) ? origin : '',
    credentials: true,
    // ...
  }));
  ```

### P0-002: `/internal/promo/run` 未認証アクセス可能

- **エンドポイント**: `POST /internal/promo/run`
- **現象**: 認証ヘッダなしで `200 {"posted":0,"failed":0}` を返す
- **攻撃ベクタ**: 外部から無制限にプロモーション実行をトリガー可能（SNS / PR Times 投稿等）
- **原因**: `auth` ミドルウェアが適用されていない
- **修正案**: 内部トークン検証、または super_admin 認証を追加。将来的に Workers Cron Triggers の署名検証に移行。

---

## P1 バグ（週内対応）

### P1-001: Checkout / Plan not found → HTTP 500

- **エンドポイント**: `POST /public/saas/:id/checkout`
- **現象**: 存在しない saas_id や plan_name で `500 {"error":"Plan not found"}` を返す
- **あるべき姿**: `404` または `400`
- **影響**: 5xx はモニタリングのアラート閾値に影響、SEO 上もネガティブ

### P1-002: セキュリティヘッダ不足

- **対象**: 全ドメイン（LP / API 両方）
- **不足ヘッダ**:
  - `Strict-Transport-Security` (HSTS) — Pages/Workers デフォルトで付与されない
  - `Content-Security-Policy` (CSP)
  - `X-Frame-Options` — クリックジャッキング防止
  - `Permissions-Policy`
- **存在するヘッダ**: `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` ✅
- **修正案**: Workers API に `secureHeaders()` Hono ミドルウェア追加。Pages は `_headers` ファイルで設定。

### P1-003: Supabase — Leaked Password Protection 無効

- **Advisors 警告**: パスワード漏洩チェック (HaveIBeenPwned) が無効
- **修正**: Supabase Dashboard > Auth > Settings で有効化

---

## P2 バグ（次スプリント）

### P2-001: LP テキスト重複

- **箇所**: 料金セクション「売上の分配について」
- **現象**: 「…自動で 70 / 30 に分配されます。されます。」
- **修正**: `preview/index.html` の該当テキストから「されます。」の重複を削除

### P2-002: LP リンク未設定 (href="#")

- **箇所**: ナビ「ログイン」、フッター「アプリ一覧」「企画を投稿」「お問合せ」「利用規約」「プライバシー」「特商法表示」
- **対応**: 各ページ完成後にリンク先を設定

### P2-003: Supabase Advisors — function_search_path_mutable 警告 (19件)

- **対象**: `handle_new_user`, `is_admin`, `generate_api_key`, `get_plan_key_limit` 等
- **リスク**: search_path 未設定の関数は search_path インジェクション攻撃に脆弱
- **修正**: 各関数に `SET search_path = ''` を追加

### P2-004: apps/dashboard/admin サブドメインが全て同一LP表示

- **現象**: Next.js アプリ未デプロイのため LP のフォールバック表示
- **対応**: Next.js ビルド・デプロイ後に自動解消

---

## 正常確認項目

| # | テスト項目 | 結果 | 詳細 |
|---|---|---|---|
| H-01 | puente-saas.com HTTPS 200 | ✅ Pass | HTTP/2, CF CDN |
| H-02 | www.puente-saas.com HTTPS 200 | ✅ Pass | |
| H-03 | apps.puente-saas.com HTTPS 200 | ✅ Pass | |
| H-04 | dashboard.puente-saas.com HTTPS 200 | ✅ Pass | |
| H-05 | admin.puente-saas.com HTTPS 200 | ✅ Pass | |
| H-06 | api.puente-saas.com Health | ✅ Pass | `{"service":"puente-store-api","env":"production"}` |
| A-01 | GET /api/admin/overview (no auth) | ✅ 401 | |
| A-02 | POST /api/saas (no auth) | ✅ 401 | |
| A-03 | POST /api/companies (no auth) | ✅ 401 | |
| A-04 | GET /api/companies/:id/revenue (no auth) | ✅ 401 | |
| A-05 | POST /api/saas (fake JWT) | ✅ 401 | |
| A-06 | POST /api/saas/:id/approve (fake JWT) | ✅ 401 | |
| A-07 | GET /nonexistent | ✅ 404 | `{"error":"not found"}` |
| A-08 | POST /stripe/webhook (no sig) | ✅ 400 | `missing signature` |
| S-01 | LP ソースにシークレット露出なし | ✅ Pass | |
| S-02 | apps ソースにシークレット露出なし | ✅ Pass | |
| S-03 | dashboard ソースにシークレット露出なし | ✅ Pass | |
| D-01 | 全17テーブル RLS 有効 | ✅ Pass | |
| D-02 | Micro SaaS 5テーブル — RLS Policy 適切 | ✅ Pass | owner_id/auth.uid() ベース |
| D-03 | 4 SECURITY DEFINER 関数存在 | ✅ Pass | |
| D-04 | CORS preflight (正規 origin) | ✅ Pass | |
| ST-01 | Stripe Webhook 署名なし拒否 | ✅ Pass | |
| ST-02 | Stripe Product/Price 登録済み | ✅ Pass | (前セッションで確認) |
| U-01 | LP 表示・構造 | ✅ Pass | Hero/Apps/Process/Pricing/Footer |
| U-02 | LP コンソールエラー | ✅ Pass | エラーなし |
| U-03 | LP 外部リンク (puentework.com) | ✅ Pass | |

---

## 次アクション（優先順）

1. **[即日]** P0-001: CORS origin ホワイトリスト化 → Workers 再デプロイ
2. **[即日]** P0-002: `/internal/promo/run` に認証追加 → Workers 再デプロイ
3. **[週内]** P1-001: Checkout エラーコード修正 (500→404)
4. **[週内]** P1-002: セキュリティヘッダ追加 (HSTS/CSP/X-Frame)
5. **[週内]** P1-003: Supabase Leaked Password Protection 有効化
6. **[次スプリント]** P2 全件
