import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';
import SaasCard from '@/components/SaasCard';

const CATEGORIES = ['business', 'learning', 'entertainment', 'infra'] as const;

export default async function AppsIndex({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const sb = createClient();
  const { data: all } = await sb
    .from('saas_projects')
    .select('id,slug,name,tagline,category,square_image_url,published_at')
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  const base = locale === 'ja' ? '' : `/${locale}`;
  return (
    <div className="container-pad py-12">
      <h1 className="font-display text-display-2">{t('apps.title')}</h1>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link href={`${base}/apps`} className="btn-ghost text-sm">{t('apps.all')}</Link>
        {CATEGORIES.map((c) => (
          <Link key={c} href={`${base}/apps/${c}`} className="btn-ghost text-sm">
            {t(`apps.category.${c}`)}
          </Link>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
        {all?.map((s) => <SaasCard key={s.id} saas={s as any} locale={locale} />)}
      </div>
    </div>
  );
}
