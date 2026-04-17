# Punete Micro SaaS Store — Phase 3 実装

1 日 Sprint（2026-04-15）で構築した Punete Micro SaaS Store プラットフォームのモノリポ。

## 構成

```
puente-store/
├── apps-web/          # Next.js 14 App Router (Cloudflare Pages)
│   ├── src/app/       # ルート (/apps, /apps/[category], /apps/[category]/[slug], /dashboard, /admin)
│   ├── src/components # 共通UI
│   ├── src/lib        # Supabase / Stripe / i18n クライアント
│   └── src/styles     # グローバル (Design System v4 Light)
├── workers-api/       # Cloudflare Workers (API: Stripe / Webhook / AI 企画解析)
│   └── src/index.ts   # Hono ルーター
├── supabase/
│   └── migrations/    # DBスキーマ
├── emails/            # Resend React Email テンプレート 6 種
├── assets/
│   ├── favicon/       # favicon stack (ico / apple-touch / 192/512 / safari-pinned / manifest)
│   └── og/            # OG 1200×630 / SNS正方形 1080×1080 (SVGテンプレート)
└── public/            # llms.txt / llms-full.txt / robots.txt / sitemap.xml
```

## デプロイ順序

1. Supabase: `supabase db push` → RLS 適用 → Seed データ投入
2. Cloudflare Workers Secrets: `wrangler secret put STRIPE_SECRET_KEY` ほか
3. Cloudflare Pages: `apps-web` を Git 連携で接続、環境変数設定
4. Stripe: Webhook エンドポイント `https://api.puente-saas.com/stripe/webhook` を登録、署名検証キー取得
5. Resend: ドメイン `puente-saas.com` に SPF / DKIM / DMARC を設定
6. DNS: `puente-saas.com` → Cloudflare Pages / `api.puente-saas.com` → Workers / `store.puente-saas.com` → Pages

## Phase 3 実装項目

| # | 項目 | ファイル |
|---|---|---|
| 1 | Supabase スキーマ（12テーブル + RLS） | `supabase/migrations/001_init.sql` |
| 2 | Cloudflare Workers API（Hono） | `workers-api/src/index.ts` |
| 3 | Stripe Connect（Destination Charges + Webhook 署名検証） | `workers-api/src/stripe.ts` |
| 4 | 80%OFFクーポン自動発行 | `workers-api/src/coupons.ts` |
| 5 | AI 企画解析エンジン（Anthropic Claude） | `workers-api/src/ai-analyzer.ts` |
| 6 | ユーザーダッシュボード | `apps-web/src/app/dashboard/` |
| 7 | スーパーアドミンダッシュボード | `apps-web/src/app/admin/` |
| 8 | インボイス登録番号入力欄 | `apps-web/src/app/dashboard/invoice/` |
| 9 | ストアフロント `/apps/` | `apps-web/src/app/[locale]/apps/` |
| 10 | 全文検索（Pagefind） | `apps-web/scripts/build-pagefind.sh` |
| 11 | 編集部セレクション / 季節特集 | `apps-web/src/app/[locale]/apps/editorial/` |
| 12 | パーソナライズ | `apps-web/src/lib/personalize.ts` |
| 13 | GA4 計測 | `apps-web/src/components/Analytics.tsx` |
| 14 | hreflang（JP/EN） | `apps-web/src/app/[locale]/` |
| 15 | SNS サムネ（OG / 正方形） | `assets/og/` |
| 16 | ファビコンスタック | `assets/favicon/` |
| 17 | AEO（llms.txt / llms-full.txt / robots） | `public/` |
| 18 | SEO 強化（sitemap / Core Web Vitals） | `apps-web/src/app/sitemap.ts` |
| 19 | Resend メールテンプレ 6 種 | `emails/` |
| 20 | PR / SNS 自動配信ワーカー | `workers-api/src/promo.ts` |

## 税務方針（重要）

本プラットフォームは**売上分配方式（レベニューシェア）**。ロイヤリティ支払い方式ではない。

- プエンテ売上: GMV の 70%
- 企画登録ユーザー売上: GMV の 30%（ユーザー自身の売上として計上）
- 源泉徴収なし、適格請求書は各自発行
- Stripe Connect Destination Charges の `application_fee_amount = amount × 0.70`

## ライセンス

Proprietary. © 2026 PUENTE Inc.
