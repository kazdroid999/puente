# E2E チェックリスト — Punete Micro SaaS Store

本番デプロイ後、このシナリオを通しで実行して全系統を検証する。

## 0. 事前
- [ ] Puente スーパー管理者アカウントの `profiles.role = 'super_admin'` 確認
- [ ] Stripe テストモード → 本番モード切替完了
- [ ] Cron triggers が Cloudflare dashboard で Active

## 1. サインアップ & 歓迎メール
- [ ] `https://puente-saas.com` → 「はじめる」→ Email Magic Link でサインアップ
- [ ] `01-welcome.tsx` メール受信（Resend → `no-reply@puente-saas.com`）
- [ ] クーポンコード `PUENTE-XXXXXXXX-FND` がメール/ダッシュボードに表示

## 2. 会社作成 & インボイス登録
- [ ] `/dashboard` で会社を作成（名前・代表者・口座下4桁）
- [ ] `/dashboard/invoice` で T+13 桁登録番号入力 → 保存成功
- [ ] 不正な `T123` で弾かれる（regex）

## 3. Stripe Connect オンボーディング
- [ ] `/dashboard` → 「Stripe Connect 接続」→ Stripe オンボーディングフロー完遂
- [ ] webhook `account.updated` 受信 → `companies.stripe_connect_charges_enabled = true`

## 4. 初期費用決済（80% OFF 適用）
- [ ] 「初期費用を支払う」→ Checkout に ¥66,000（税込）表示
- [ ] 決済完了 → `initial_fee_invoices.status = 'paid'`
- [ ] 管理画面で売上確認（Puente 100%）

## 5. 企画投稿 → AI 解析
- [ ] `/dashboard/new` でブリーフ送信
- [ ] `saas_projects.status`: draft → ai_analyzing → pending_approval
- [ ] `ai_plan` JSON が BEP / tech_stack / roadmap_3day を含む

## 6. 承認 & 公開
- [ ] Puente スーパー管理者ログイン → `/admin` で pending 承認
- [ ] `02-plan-approved.tsx` メール受信
- [ ] 開発完了後、プレビュー URL を super_admin が投入 → `03-preview-ready.tsx` 受信
- [ ] ユーザーが「公開」ボタン → Stripe Product + 3 Prices 作成 → status=published → `04-launched.tsx`

## 7. エンドユーザー購読
- [ ] 別ブラウザでストア → 該当 SaaS 詳細 → ¥980 プラン Subscribe
- [ ] Stripe Checkout 完了 → `customer.subscription.created` webhook
- [ ] `charge.succeeded` → `revenue_events` に puente_revenue=686 / user_revenue=294 記録

## 8. 売上分配確認
- [ ] ユーザー `/dashboard/revenue` で GMV ¥980 / ユーザー売上 ¥294 / Puente 売上 ¥686 表示
- [ ] Stripe Connect destination の残高に ¥294 着金
- [ ] `/admin` 全社 GMV 集計が +¥980

## 9. 月次振込
- [ ] 月初 Cron 実行（または手動 `/internal/monthly-payout`）
- [ ] ユーザー指定口座への Stripe Payout 実行
- [ ] `05-payout.tsx` メール受信（金額 / 口座下4桁 / 売上分配文言）

## 10. 決済失敗 / Dunning
- [ ] Stripe テストカード `4000 0000 0000 0341` で購読 → 更新で失敗
- [ ] `invoice.payment_failed` webhook → `06-payment-failed.tsx` 受信
- [ ] 4 回失敗で subscription canceled

## 11. SEO / AEO
- [ ] `/sitemap.xml` に hreflang ja/en 両方
- [ ] `/robots.txt` で ClaudeBot/GPTBot/PerplexityBot allow
- [ ] `/llms.txt` `/llms-full.txt` 配信確認
- [ ] 詳細ページに JSON-LD SoftwareApplication + Offer
- [ ] OG 画像 1200×630 が Twitter Card Validator / Facebook Debugger で OK

## 12. プロモーション自動化
- [ ] 公開時に `promo_posts` に PR Times / Wix Blog / X / Instagram / TikTok / YouTube Short のタスク挿入
- [ ] 10 分 Cron が順次投稿 → status=posted

## 13. RLS & 権限
- [ ] 他社ユーザーの company_id で `/api/companies/:id/revenue` → 403
- [ ] super_admin 以外で `/api/saas/:id/approve` → 403
- [ ] 未ログインで `/dashboard` → `/login` リダイレクト

---
全項目 ✅ で Phase3 ローンチ完了。
