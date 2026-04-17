import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';
import SaasCard from '@/components/SaasCard';

export default async function EditorialDetail({
  params: { slug, locale },
}: {
  params: { slug: string; locale: string };
}) {
  setRequestLocale(locale);
  const sb = createClient();
  const { data: col } = await sb
    .from('editorial_collections')
    .select('*, editorial_items(sort_order, saas:saas_projects(id,slug,name,tagline,category,square_image_url))')
    .eq('slug', slug)
    .single();
  if (!col) notFound();
  const items = (col.editorial_items ?? [])
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((r: any) => r.saas)
    .filter(Boolean);

  return (
    <div className="container-pad py-12">
      <h1 className="font-display text-display-2">
        {locale === 'en' ? col.title_en ?? col.title : col.title}
      </h1>
      <p className="mt-3 max-w-2xl text-muted">
        {locale === 'en' ? col.description_en ?? col.description : col.description}
      </p>
      <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5">
        {items.map((s: any) => <SaasCard key={s.id} saas={s} locale={locale} />)}
      </div>
    </div>
  );
}
