// オーナー自発拡散ダッシュボード
import { createClient } from '@/lib/supabase-server';
import ShareCard from './ShareCard';

export default async function SharePage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const { data: companies } = await sb
    .from('companies')
    .select('id,name')
    .eq('owner_user_id', user.id);
  const companyIds = (companies ?? []).map((c) => c.id);

  const { data: saasList } = await sb
    .from('saas_projects')
    .select('id,name,slug,category,tagline,status')
    .in('company_id', companyIds)
    .eq('status', 'published');

  const { data: stats } = await sb
    .from('v_owner_share_stats')
    .select('*')
    .in('company_id', companyIds);

  const { data: ranking } = await sb
    .from('v_share_ranking_monthly')
    .select('*')
    .order('rank', { ascending: true })
    .limit(10);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl font-bold">シェアして広める</h1>
        <p className="mt-2 text-muted">
          公開中の Micro SaaS をワンクリックで SNS に投稿。流入とコンバージョンを可視化します。
        </p>
      </header>

      <section className="rounded-2xl border border-line bg-surface p-6">
        <h2 className="font-bold mb-4">月間紹介ランキング Top 10（インセンティブ対象）</h2>
        <p className="mb-4 text-sm text-muted">
          月間 Top 10 に入ると翌月 PR Times 特集枠を獲得できます。
        </p>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr><th>順位</th><th>会社</th><th>コンバージョン</th><th>GMV</th></tr>
          </thead>
          <tbody>
            {(ranking ?? []).map((r: any) => (
              <tr key={`${r.month}-${r.company_id}`} className="border-t border-line">
                <td className="py-2">#{r.rank}</td>
                <td>{r.company_name}</td>
                <td>{r.conversions}</td>
                <td>¥{Number(r.gmv).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {(saasList ?? []).map((s: any) => {
          const stat = stats?.find((x: any) => x.saas_id === s.id);
          return <ShareCard key={s.id} saas={s} stat={stat} />;
        })}
      </section>
    </div>
  );
}
