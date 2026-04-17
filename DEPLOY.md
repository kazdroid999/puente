# Deployment Runbook — Punete Micro SaaS Store

初回デプロイ手順。3 ドメイン構成 (`puente-saas.com` / `api.puente-saas.com` / `store.puente-saas.com`) を 1 日で立ち上げる想定。

## 前提
- Cloudflare account (Puente Inc.) with Pages + Workers + DNS for `puente-saas.com`
- Supabase organization (Tokyo region) 新規プロジェクト `puente-store-prod`
- Stripe アカウント (日本法人 / JPY) + Connect 有効化済み
- Resend アカウント
- Anthropic API key
- GitHub repo: `puente-inc/puente-store` (monorepo)
- Notion / PR Times / Wix / X / Instagram / TikTok / YouTube API tokens

## 1. Supabase — Database & Auth
```bash
cd puente-store/db
supabase link --project-ref <prod-ref>
supabase db push              # migrations/*.sql 適用
supabase db execute -f views.sql
```
- Dashboard → Authentication → Providers: Email (Magic Link) + Google OAuth を有効化
- Redirect URLs: `https://puente-saas.com/auth/callback`
- `profiles.role = 'super_admin'` を Puente スーパー管理者アカウントの user_id に手動 UPDATE

## 2. Workers API — api.puente-saas.com
```bash
cd puente-store/workers-api
npm i
wrangler login
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_CONNECT_WEBHOOK_SECRET
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put SUPABASE_JWT_SECRET
wrangler secret put RESEND_API_KEY
wrangler secret put PRTIMES_API_KEY
wrangler deploy
```
- Cloudflare DNS: `api` → Worker route `api.puente-saas.com/*`
- カスタムドメイン紐付け → HTTPS 自動発行確認

## 3. Stripe
- Dashboard → Developers → Webhooks
  - Platform endpoint: `https://api.puente-saas.com/stripe/webhook`
    - events: `checkout.session.completed, customer.subscription.*, charge.succeeded, payout.paid`
  - Connect endpoint: 同 URL 別 secret
    - events: `account.updated`
- Branding / Connect settings に Puente ロゴ・返金ポリシー登録
- Tax: Stripe Tax を ON（JP 10% 内税）

## 4. Pages Web — puente-saas.com
```bash
cd puente-store/apps-web
npm i
npm run build && npm run pagefind   # apps-web/public/pagefind 生成
```
- Cloudflare Pages → Create project → Connect `puente-inc/puente-store`
- Build command: `cd apps-web && npm ci && npm run build && npm run pagefind`
- Output: `apps-web/.next`
- Env vars:
  - `NEXT_PUBLIC_SITE_URL=https://puente-saas.com`
  - `NEXT_PUBLIC_API_ORIGIN=https://api.puente-saas.com`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `NEXT_PUBLIC_GA4_ID`
  - `SUPABASE_SERVICE_ROLE_KEY` (server only)
- Custom domain: `puente-saas.com` (Apex + www redirect) / `store.puente-saas.com` (予約)

## 5. Resend DNS
`emails/DNS.md` の通りに Cloudflare DNS に SPF / DKIM / DMARC を追加し Resend で Verify。

## 6. Notion / PR Times / SNS
- Notion DB: SaaS 案件ハブ (DB ID を `NOTION_DB_ID` に設定)
- PR Times API key を Workers secret へ
- Wix/X/Instagram/TikTok/YouTube は Phase3.5 で順次

## 7. Cron
`wrangler.toml`:
```
[triggers]
crons = ["*/10 * * * *", "0 0 1 * *"]
```
- 10 分毎: `/internal/promo/run`
- 毎月 1 日 00:00 JST: 月次集計 → Resend payout メール送信

## 8. 動作確認
`E2E.md` チェックリスト参照。
