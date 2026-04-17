// 05. 月次売上分配振込 完了
import { EmailLayout } from './_layout';

export default function Payout({ name, amountJpy, month, bankLast4 }: { name: string; amountJpy: number; month: string; bankLast4: string }) {
  return (
    <EmailLayout title="売上分配振込完了">
      <h1 style={{ fontSize: 22 }}>{month} 分の売上をお振込しました</h1>
      <p>{name} 様</p>
      <table style={{ marginTop: 24, width: '100%', fontSize: 16 }}>
        <tbody>
          <tr><td>振込金額</td><td align="right"><strong>¥{amountJpy.toLocaleString()}</strong></td></tr>
          <tr><td>振込先</td><td align="right">口座 ****{bankLast4}</td></tr>
        </tbody>
      </table>
      <p style={{ marginTop: 24, color: '#666', fontSize: 13 }}>
        本金額はお客様の売上（30%）として計上されます。プエンテからのロイヤリティ支払いではありません。
        インボイス（適格請求書）が必要な場合は顧客向けに各自ご発行ください。
      </p>
    </EmailLayout>
  );
}
