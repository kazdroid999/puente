# GitHub Actions Workflows

## Cloudflare Pages 自動デプロイ

このリポジトリの `main` ブランチに push されると、対応する Cloudflare Pages プロジェクトへ自動でデプロイされます。

| Workflow | トリガー（paths） | デプロイ先 | 対象ドメイン |
|---|---|---|---|
| `deploy-puente-store.yml` | `preview/**` | Pages: `puente-store` | puente-saas.com / www / apps / admin / dashboard |
| `deploy-puente-apps.yml` | `apps-deploy/**` | Pages: `puente-apps` | *.puente-saas.com（23 サブドメイン）|

path に一致しない変更（例: `workers-api/` のみの更新）では Pages のデプロイは走りません。

## 初回セットアップ（必須）

### 1. Cloudflare API トークン発行

1. https://dash.cloudflare.com/profile/api-tokens を開く
2. 「Create Token」→「Custom token」
3. 設定:
   - **Token name**: `github-actions-pages-deploy`
   - **Permissions**: `Account` → `Cloudflare Pages` → `Edit`
   - **Account Resources**: Include → `Kaz@puentework.com's Account`
   - **TTL**: なし（永続）。運用で回したいので長く使う
4. Continue → Create → 表示されたトークン文字列をコピー

### 2. GitHub Secret に登録

1. https://github.com/kazdroid999/puente/settings/secrets/actions を開く
2. 「New repository secret」をクリック
3. 設定:
   - **Name**: `CLOUDFLARE_API_TOKEN`
   - **Secret**: コピーしたトークン文字列をペースト
4. Add secret

### 3. 初回動作確認

secret 登録後、以下のいずれかで動作確認:

- **A) 手動トリガー**: https://github.com/kazdroid999/puente/actions/workflows/deploy-puente-store.yml → 「Run workflow」ボタン → main 選択 → Run
- **B) テスト push**: `preview/` 配下のいずれかのファイルを少し編集して main に push
- **C) Claude に指示**: 「deploy-puente-store を手動起動して」と伝えれば私が GitHub API でトリガーします

成功すると:
- Actions タブに緑チェック
- 数十秒〜1 分で Cloudflare Pages の Deployments に新エントリ
- puente-saas.com に変更反映

## 手動デプロイ（緊急時）

ローカルで wrangler を使う場合:

```bash
export CLOUDFLARE_API_TOKEN="<token>"
export CLOUDFLARE_ACCOUNT_ID="1406a3260412719d49e409e5d735dfdd"
npx wrangler pages deploy preview --project-name=puente-store --branch=main
```

## 他の Cloudflare Pages プロジェクト

- `puente-mcp-hub` (puentemcp.com) は別リポジトリで管理中。同じパターンのワークフローを張ると楽。
- LP の「注目 Micro SaaS」カード群のうち `ma-portal.net` / `hojokin-ai.org` / `aiceosimulator.com` / `ken-ringo.com` / `alive-casino.games` は **Netlify ホスティング**のため本リポの GitHub Actions 対象外。

## トラブルシューティング

### Actions が走らない
- `preview/` 配下のファイルが変わっていない可能性。`paths` フィルタを確認
- Actions 自体が無効化されていないか: Settings → Actions → General

### Deploy が Authentication error で失敗
- トークンに `Cloudflare Pages → Edit` 権限が付いているか確認
- GitHub Secret 名が `CLOUDFLARE_API_TOKEN` 完全一致か

### ビルドは成功したが本番に反映されない
- wrangler 出力の `https://<uuid>.puente-store.pages.dev` にはアクセスできるか
- `--branch=main` が指定されているか（preview ブランチだと production ドメインに出ない）
