// 03. プレビューURL通知
import { EmailLayout } from './_layout';

export default function PreviewReady({ name, saasName, previewUrl }: { name: string; saasName: string; previewUrl: string }) {
  return (
    <EmailLayout title="プレビュー準備完了">
      <h1 style={{ fontSize: 22 }}>{name} 様</h1>
      <p><strong>{saasName}</strong> のプレビューが準備できました。非公開リンクで最終ご確認をお願いします。</p>
      <p style={{ margin: '24px 0' }}>
        <a href={previewUrl} style={{ background: '#FF5A1F', color: '#fff', padding: '12px 20px', borderRadius: 999, textDecoration: 'none' }}>
          プレビューを開く →
        </a>
      </p>
      <p>問題なければダッシュボードから「公開」ボタンで即時ローンチされます。</p>
    </EmailLayout>
  );
}
