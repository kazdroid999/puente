import { createClient } from '@/lib/supabase-server';
import InvoiceForm from './InvoiceForm';

export default async function InvoicePage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: companies } = await sb
    .from('companies')
    .select('id,legal_name,invoice_registration_number,is_invoice_registered')
    .eq('owner_id', user!.id);

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-3xl font-bold">適格請求書発行事業者登録番号</h1>
      <p className="mt-3 text-muted">
        本プラットフォームは <strong>売上分配方式（レベニューシェア）</strong> を採用しており、
        プエンテと企画者は各自の売上として計上します。そのため、プエンテから企画者へ適格請求書を発行する必要はありませんが、
        企画者ご自身がサブスク顧客に対してインボイス制度に対応される場合の管理情報として、T + 13桁の登録番号を入力してください。
      </p>
      <div className="mt-8 grid gap-6">
        {companies?.map((c) => <InvoiceForm key={c.id} company={c as any} />)}
      </div>
    </div>
  );
}
