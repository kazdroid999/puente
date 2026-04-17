import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';

export default async function DashboardIndex() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  const { data: companies } = await sb
    .from('companies')
    .select('id,legal_name,stripe_connect_status,invoice_registration_number,first_launch_at')
    .eq('owner_id', user!.id);
  const { data: saas } = await sb
    .from('saas_projects')
    .select('id,name,status,slug,category')
    .in('company_id', (companies ?? []).map((c) => c.id));

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-3xl font-bold">ダッシュボード</h1>
      <p className="mt-2 text-muted">{user?.email}</p>

      <section className="mt-10">
        <h2 className="font-semibold">法人情報</h2>
        <div className="mt-4 grid gap-4">
          {companies?.length === 0 && (
            <div className="card p-6">
              <p className="text-muted">まず法人情報を登録してください。</p>
              <Link href="/dashboard/new" className="btn-primary mt-4">法人を登録</Link>
            </div>
          )}
          {companies?.map((c) => (
            <div key={c.id} className="card flex items-center justify-between p-6">
              <div>
                <div className="font-semibold">{c.legal_name}</div>
                <div className="mt-1 text-sm text-muted">
                  Connect: {c.stripe_connect_status} ・
                  Invoice: {c.invoice_registration_number ?? '未登録'} ・
                  {c.first_launch_at ? '初期費用決済済み' : '初期費用未決済'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="font-semibold">企画一覧</h2>
        <div className="mt-4 grid gap-3">
          {saas?.length === 0 && <p className="text-muted">まだ企画がありません。</p>}
          {saas?.map((s) => (
            <Link key={s.id} href={`/apps/${s.category}/${s.slug}`} className="card flex items-center justify-between p-4 hover:border-ink">
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-muted">{s.status}</div>
              </div>
              <span className="text-sm text-accent">→</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
