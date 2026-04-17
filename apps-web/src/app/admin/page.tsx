import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';

export default async function AdminOverview() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login?next=/admin');
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'super_admin') redirect('/');

  const [companies, saasPublished, activeSubs, monthly, pending] = await Promise.all([
    sb.from('companies').select('*', { count: 'exact', head: true }),
    sb.from('saas_projects').select('*', { count: 'exact', head: true }).eq('status', 'published'),
    sb.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    sb.from('v_monthly_revenue').select('*').order('month', { ascending: false }).limit(12),
    sb.from('saas_projects').select('id,name,status,created_at').in('status', ['pending_approval', 'ready_for_review']).order('created_at', { ascending: true }),
  ]);

  const totalGmv = (monthly.data ?? []).reduce((s: number, m: any) => s + (m.gmv ?? 0), 0);
  const totalPuente = (monthly.data ?? []).reduce((s: number, m: any) => s + (m.puente_revenue ?? 0), 0);

  return (
    <div className="min-h-screen bg-bg p-10">
      <h1 className="font-display text-3xl font-bold">Super Admin</h1>
      <p className="mt-2 text-muted">{user.email} / 全社横断ビュー</p>

      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="法人数" value={companies.count ?? 0} />
        <Stat label="公開中 SaaS" value={saasPublished.count ?? 0} />
        <Stat label="有効サブスク" value={activeSubs.count ?? 0} />
        <Stat label="直近12ヶ月 GMV" value={`¥${totalGmv.toLocaleString()}`} />
        <Stat label="プエンテ売上 (70%)" value={`¥${totalPuente.toLocaleString()}`} />
      </div>

      <section className="mt-12">
        <h2 className="font-semibold">承認待ち企画</h2>
        <ul className="mt-4 space-y-2">
          {pending.data?.map((p) => (
            <li key={p.id} className="card flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-muted">{p.status} ・ {new Date(p.created_at).toLocaleDateString()}</div>
              </div>
              <a href={`/admin/saas/${p.id}`} className="btn-ghost text-sm">詳細 →</a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-semibold">月次売上（全社）</h2>
        <table className="mt-4 w-full text-sm">
          <thead className="border-b border-line text-left text-muted">
            <tr>
              <th className="py-2">月</th>
              <th>SaaS</th>
              <th className="text-right">GMV</th>
              <th className="text-right">Puente 70%</th>
              <th className="text-right">User 30%</th>
            </tr>
          </thead>
          <tbody>
            {monthly.data?.map((m: any, i) => (
              <tr key={i} className="border-b border-line">
                <td className="py-2">{new Date(m.month).toISOString().slice(0, 7)}</td>
                <td>{m.saas_id.slice(0, 8)}</td>
                <td className="text-right">¥{m.gmv.toLocaleString()}</td>
                <td className="text-right">¥{m.puente_revenue.toLocaleString()}</td>
                <td className="text-right text-muted">¥{m.user_revenue.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-2 font-display text-2xl font-bold">{value}</div>
    </div>
  );
}
