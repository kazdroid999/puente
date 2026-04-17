// 共通レイアウト（React Email）
export function EmailLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <html>
      <head>
        <title>{title}</title>
      </head>
      <body style={{ fontFamily: 'sans-serif', background: '#FAFAF7', color: '#0F0F0F', margin: 0 }}>
        <table width="100%" cellPadding={0} cellSpacing={0} style={{ background: '#FAFAF7' }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '40px 20px' }}>
                <table width={600} cellPadding={0} cellSpacing={0} style={{ background: '#fff', borderRadius: 16, overflow: 'hidden' }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '32px 40px', borderBottom: '1px solid #E5E5E0' }}>
                        <strong style={{ fontSize: 20 }}>Punete Micro SaaS Store</strong>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '32px 40px' }}>{children}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '24px 40px', borderTop: '1px solid #E5E5E0', color: '#666', fontSize: 12 }}>
                        株式会社プエンテ / 〒359-1106 埼玉県所沢市東狭山ヶ丘2-2951-44<br />
                        <a href="https://puente-saas.com" style={{ color: '#FF5A1F' }}>puente-saas.com</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
