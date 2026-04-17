// 04. ローンチ完了
import { EmailLayout } from './_layout';

export default function Launched({ name, saasName, publicUrl }: { name: string; saasName: string; publicUrl: string }) {
  return (
    <EmailLayout title="🎉 ローンチ完了">
      <h1 style={{ fontSize: 24 }}>{saasName} がローンチしました。</h1>
      <p>{name} 様のアイディアが、世界に公開されました。</p>
      <p style={{ margin: '24px 0' }}>
        <a href={publicUrl} style={{ background: '#0F0F0F', color: '#fff', padding: '12px 20px', borderRadius: 999, textDecoration: 'none' }}>
          アプリを開く → {publicUrl}
        </a>
      </p>
      <p>PR Times / Wix Blog / X / Instagram / TikTok / YouTube Short への自動配信を順次実行します。</p>
    </EmailLayout>
  );
}
