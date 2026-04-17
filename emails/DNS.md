# Email DNS Setup — puente-saas.com (Resend)

送信アドレス: `no-reply@puente-saas.com` / `support@puente-saas.com`

## 1. Resend にドメイン追加
1. https://resend.com/domains → "Add Domain" → `puente-saas.com`
2. Region: `ap-northeast-1` (Tokyo) を選択
3. 表示された DNS レコードを Cloudflare DNS に追加

## 2. Cloudflare DNS レコード

| Type  | Name                         | Value                                                    | Proxy |
|-------|------------------------------|----------------------------------------------------------|-------|
| MX    | send                         | `feedback-smtp.ap-northeast-1.amazonses.com` (priority 10) | DNS only |
| TXT   | send                         | `v=spf1 include:amazonses.com ~all`                      | DNS only |
| TXT   | resend._domainkey            | （Resend 管理画面で生成された DKIM 値）                   | DNS only |
| TXT   | _dmarc                       | `v=DMARC1; p=quarantine; rua=mailto:dmarc@puente-saas.com; pct=100; adkim=s; aspf=s` | DNS only |

### ルートドメイン SPF（他の送信経路がない場合）
| Type | Name | Value |
|------|------|-------|
| TXT  | @    | `v=spf1 include:amazonses.com -all` |

## 3. 検証
- Resend 管理画面 → Verify すべて ✅ に
- `dig TXT puente-saas.com` / `dig TXT resend._domainkey.puente-saas.com` で伝播確認
- テスト送信: https://resend.com/emails → Send Test

## 4. Workers 側 Secrets
```
wrangler secret put RESEND_API_KEY       # re_xxx
wrangler secret put RESEND_FROM          # Puente Micro SaaS Store <no-reply@puente-saas.com>
```
