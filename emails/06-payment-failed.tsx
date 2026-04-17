// 06. 決済失敗 / Dunning
import { EmailLayout } from './_layout';

export default function PaymentFailed({ name, saasName, updateUrl, attemptCount }: { name: string; saasName: string; updateUrl: string; attemptCount: number }) {
  return (
    <EmailLayout title="お支払いに失敗しました">
      <h1 style={{ fontSize: 22 }}>{name} 様</h1>
      <p><strong>{saasName}</strong> のサブスクリプション課金に失敗しました（{attemptCount} 回目）。</p>
      <p>カード情報をご確認ください。4 回連続で失敗するとサブスクリプションは自動停止されます。</p>
      <p style={{ margin: '24px 0' }}>
        <a href={updateUrl} style={{ background: '#FF5A1F', color: '#fff', padding: '12px 20px', borderRadius: 999, textDecoration: 'none' }}>
          カード情報を更新する →
        </a>
      </p>
      <p style={{ color: '#666', fontSize: 13 }}>
        ご不明な点は support@puente-saas.com までご連絡ください。
      </p>
    </EmailLayout>
  );
}
