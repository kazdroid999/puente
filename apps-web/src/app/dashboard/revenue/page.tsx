import { createClient } from '@/lib/supabase-server';

export default async function RevenuePage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: companies } = await sb
    .from('companies')
    .select('id,legal_name')
    .eq('owner_id', user!.id);
  const companyIds = (companies ?? []).map((c) => c.id);

  const { data: monthly } = await sb
    .from('v_monthly_revenue')
    .select('*')
    .in('company_id', companyIds)
    .order('month', { ascending: false })
    .limit(24);

  const { data: balances } = await sb
    .from('v_company_connect_balance')
    .select('*')
    .in('company_id', companyIds);

  return (
    <div className="max-w-5xl">
      <h1 className="font-display text-3xl font-bold">売上（売上分配）</h1>
      <p className="mt-2 text-sm text-muted">
        Puente 70% / ご自身 30% の売上分配方式。GMV の 30% がご自身の売上として計上されます。
      </p>

      <section className="mt-8">
        <h2 className="font-semibold">会社別 出金可能残高</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {balances?.map((b: any) => (
            <div key={b.company_id} className="card p-6">
              <div className="text-sm text-muted">{b.legal_name}</div>
              <div className="mt-2 font-display text-3xl">¥{b.available_balance_jpy.toLocaleString()}</div>
              <p className="mt-2 text-xs text-muted">翌月末に Stripe Connect 経由で自動振込されます。</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-semibold">月次売上</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="py-2">月</th>
              <th>SaaS</th>
              <th className="text-right">GMV</th>
              <th className="text-right">あなたの売上(30%)</th>
              <th className="text-right">Puente 売上(70%)</th>
              <th className="text-right">取引数</th>
            </tr>
          </thead>
          <tbody>
            {monthly?.map((m: any, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2">{new Date(m.month).toISOString().slice(0, 7)}</td>
                <td>{m.saas_id.slice(0, 8)}</td>
                <td className="text-right">¥{m.gmv.toLocaleString()}</td>
                <td className="text-right">¥{m.user_revenue.toLocaleString()}</td>
                <td className="text-right text-muted">¥{m.puente_revenue.toLocaleString()}</td>
                <td className="text-right">{m.txn_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
