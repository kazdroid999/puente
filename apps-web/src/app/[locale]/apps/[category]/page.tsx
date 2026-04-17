import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';
import SaasCard from '@/components/SaasCard';

const CATEGORIES = ['business', 'learning', 'entertainment', 'infra'];

export async function generateStaticParams() {
  return CATEGORIES.map((category) => ({ category }));
}

export default async function CategoryPage({
  params: { locale, category },
}: {
  params: { locale: string; category: string };
}) {
  if (!CATEGORIES.includes(category)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const sb = createClient();
  const { data } = await sb
    .from('saas_projects')
    .select('id,slug,name,tagline,category,square_image_url')
    .eq('status', 'published')
    .eq('category', category)
    .order('published_at', { ascending: false });

  return (
    <div className="container-pad py-12">
      <h1 className="font-display text-display-2">{t(`apps.category.${category}` as any)}</h1>
      <div className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
        {data?.map((s) => <SaasCard key={s.id} saas={s as any} locale={locale} />)}
      </div>
    </div>
  );
}
