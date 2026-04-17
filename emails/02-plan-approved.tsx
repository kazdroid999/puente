// 02. AI 企画 承認完了 → 開発開始通知
import { EmailLayout } from './_layout';

export default function PlanApproved({ name, saasName }: { name: string; saasName: string }) {
  return (
    <EmailLayout title="企画が承認されました">
      <h1 style={{ fontSize: 22 }}>{name} 様</h1>
      <p>ご投稿いただいた企画 <strong>{saasName}</strong> を Puente が承認しました。</p>
      <p>ボリビアオフショア開発チームが実装を開始します。原則 3 日以内にプレビュー URL をダッシュボードへ通知します。</p>
    </EmailLayout>
  );
}
