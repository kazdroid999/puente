import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';
import SaasCard from '@/components/SaasCard';

export default async function Home({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const sb = createClient();
  const { data: featured } = await sb
    .from('saas_projects')
    .select('id,slug,name,tagline,category,square_image_url')
    .eq('status', 'published')
    .eq('featured', true)
    .limit(8);
  const { data: recent } = await sb
    .from('saas_projects')
    .select('id,slug,name,tagline,category,square_image_url')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(12);

  const base = locale === 'ja' ? '' : `/${locale}`;
  return (
    <>
      <section className="container-pad py-16 md:py-24">
        <h1 className="font-display text-display-2 md:text-display-1">{t('common.tagline')}</h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          企画概要・業務内容・欲しい機能を投稿するだけ。AIが事業計画・BEP・技術スタックを自動生成し、
          Puente 承認のうえボリビアチームが開発。3日でサブスク課金モデルのWebサービスが立ち上がります。
        </p>
        <div className="mt-8 flex gap-4">
          <Link href="/dashboard/new" className="btn-primary">{t('common.cta_primary')}</Link>
          <Link href={`${base}/apps`} className="btn-ghost">{t('common.cta_secondary')}</Link>
        </div>
      </section>

      {featured && featured.length > 0 && (
        <section className="container-pad py-8">
          <div className="mb-6 flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-bold">{t('apps.featured')}</h2>
            <Link href={`${base}/apps`} className="text-sm text-accent">See all →</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {featured.map((s) => <SaasCard key={s.id} saas={s as any} locale={locale} />)}
          </div>
        </section>
      )}

      <section className="container-pad py-8">
        <h2 className="mb-6 font-display text-2xl font-bold">{t('apps.new')}</h2>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          {recent?.map((s) => <SaasCard key={s.id} saas={s as any} locale={locale} />)}
        </div>
      </section>
    </>
  );
}
