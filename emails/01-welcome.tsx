// 01. サインアップ歓迎 + 80%OFFクーポン
import { EmailLayout } from './_layout';

export default function Welcome({ name, couponCode }: { name: string; couponCode: string }) {
  return (
    <EmailLayout title="Punete Micro SaaS Store へようこそ">
      <h1 style={{ fontSize: 24, margin: '0 0 16px' }}>{name} 様、ようこそ。</h1>
      <p>Punete Micro SaaS Store にサインアップいただきありがとうございます。</p>
      <p>初期費用 <strong>80%OFF</strong> のファウンダー特典クーポンを発行しました。</p>
      <div style={{ background: '#FFE4D6', padding: 16, borderRadius: 12, margin: '24px 0', textAlign: 'center' }}>
        <code style={{ fontSize: 24, letterSpacing: 2 }}>{couponCode}</code>
      </div>
      <p>ダッシュボードから最初の企画を投稿し、3日後のローンチを体験してください。</p>
      <p style={{ marginTop: 32 }}>
        <a href="https://puente-saas.com/dashboard/new" style={{ background: '#0F0F0F', color: '#fff', padding: '12px 20px', borderRadius: 999, textDecoration: 'none' }}>
          企画を投稿する →
        </a>
      </p>
    </EmailLayout>
  );
}
