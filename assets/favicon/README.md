# Favicon Stack

ベクター: `favicon.svg` をビルド時に以下へ書き出す。

| 出力 | サイズ | 用途 |
|---|---|---|
| `favicon.ico` | 16/32/48 multi | 旧ブラウザ |
| `icon-192.png` | 192×192 | PWA (Chrome Android) |
| `icon-512.png` | 512×512 | PWA |
| `icon-512-maskable.png` | 512×512 (safe zone 80%) | maskable icon |
| `apple-touch-icon.png` | 180×180 | iOS |
| `safari-pinned-tab.svg` | monochrome SVG | Safari |

## 書き出しコマンド例

```bash
# ImageMagick 7.x
magick favicon.svg -resize 192x192 icon-192.png
magick favicon.svg -resize 512x512 icon-512.png
magick favicon.svg -resize 180x180 apple-touch-icon.png
magick favicon.svg -define icon:auto-resize=16,32,48 favicon.ico
```

公開時は `apps-web/public/` に配置。manifest は `public/site.webmanifest`。
