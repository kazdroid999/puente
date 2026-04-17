# SNS サムネイルテンプレート

- `og-default.svg` — 1200×630 (Twitter/X / Facebook / LinkedIn 汎用 OG)
- `square-default.svg` — 1080×1080 (Instagram / TikTok カバー / YouTube Short カバー)

各 SaaS 個別 OG は、上記 SVG のテキスト部分を AI で差し替えて生成する。
書き出し: `resvg` もしくは `sharp` で PNG 化し、`/public/og/{slug}.png` および `/public/square/{slug}.png` に配置。

```bash
# sharp で PNG 書き出し (Node.js)
node -e "require('sharp')('og-default.svg').png().toFile('og-default.png')"
```

新 SaaS 公開時は `workers-api/src/promo.ts` の拡張で自動生成する想定。
