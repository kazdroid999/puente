import Link from 'next/link';
import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';

export default async function EditorialIndex({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale);
  const sb = createClient();
  const { data } = await sb
    .from('editorial_collections')
    .select('*')
    .order('sort_order', { ascending: true });
  const base = locale === 'ja' ? '' : `/${locale}`;
  return (
    <div className="container-pad py-12">
      <h1 className="font-display text-display-2">編集部セレクション</h1>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {data?.map((c) => (
          <Link key={c.id} href={`${base}/apps/editorial/${c.slug}`} className="card overflow-hidden hover:border-ink">
            {c.hero_image_url && (
              <div className="aspect-[16/9] bg-line">
                <img src={c.hero_image_url} alt={c.title} className="h-full w-full object-cover" />
              </div>
            )}
            <div className="p-6">
              <h2 className="font-display text-xl font-bold">{locale === 'en' ? c.title_en ?? c.title : c.title}</h2>
              <p className="mt-2 text-muted">
                {locale === 'en' ? c.description_en ?? c.description : c.description}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
