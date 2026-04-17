#!/usr/bin/env bash
# ビルド後に Pagefind を .next/server の出力に対してかける
set -euo pipefail
OUT_DIR="${OUT_DIR:-.next/server/app}"
PUBLIC_DIR="public/pagefind"
npx pagefind --site .next/server/app --output-path "${PUBLIC_DIR}" || echo "pagefind skipped (no SSR output yet)"
