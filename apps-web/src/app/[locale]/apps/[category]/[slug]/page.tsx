import { notFound } from 'next/navigation';
import Image from 'next/image';
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { createClient } from '@/lib/supabase-server';
import { trackView, recommendedForVisitor } from '@/lib/personalize';
import SaasCard from '@/components/SaasCard';
import SubscribeButton from '@/components/SubscribeButton';

export async function generateMetadata(
  { params: { slug, locale } }: { params: { slug: string; locale: string } },
): Promise<Metadata> {
  const sb = createClient();
  const { data } = await sb
    .from('saas_projects')
    .select('name,name_en,tagline,tagline_en,og_image_url,slug,category')
    .eq('slug', slug)
    .single();
  if (!data) return {};
  const name = locale === 'en' ? data.name_en ?? data.name : data.name;
  const tagline = locale === 'en' ? data.tagline_en ?? data.tagline : data.tagline;
  return {
    title: name,
    description: tagline ?? undefined,
    openGraph: { title: name, description: tagline ?? undefined, images: data.og_image_url ? [data.og_image_url] : [] },
    alternates: {
      canonical: `https://puente-saas.com/${locale === 'ja' ? '' : 'en/'}apps/${data.category}/${data.slug}`,
      languages: {
        ja: `https://puente-saas.com/apps/${data.category}/${data.slug}`,
        en: `https://puente-saas.com/en/apps/${data.category}/${data.slug}`,
      },
    },
  };
}

export default async function SaasDetail({
  params: { slug, category, locale },
}: {
  params: { slug: string; category: string; locale: string };
}) {
  setRequestLocale(locale);
  const sb = createClient();
  const { data: saas } = await sb
    .from('saas_projects')
    .select('*, saas_plans(name,price_jpy,features)')
    .eq('slug', slug)
    .eq('category', category)
    .eq('status', 'published')
    .single();
  if (!saas) notFound();

  // パーソナライズ用に閲覧記録
  await trackView(saas.id, saas.category);
  const recs = await recommendedForVisitor(6);

  const name = locale === 'en' ? saas.name_en ?? saas.name : saas.name;
  const tagline = locale === 'en' ? saas.tagline_en ?? saas.tagline : saas.tagline;
  const desc = locale === 'en' ? saas.long_description_en ?? saas.long_description : saas.long_description;

  return (
    <article className="container-pad py-12">
      <header className="flex flex-col gap-6 md:flex-row">
        <div className="aspect-square w-full max-w-[240px] overflow-hidden rounded-2xl bg-line relative">
          {saas.square_image_url && (
            <Image src={saas.square_image_url} alt={name} fill sizes="240px" className="object-cover" priority />
          )}
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-accent">{category}</div>
          <h1 className="mt-2 font-display text-display-2">{name}</h1>
          {tagline && <p className="mt-3 text-lg text-muted">{tagline}</p>}
          {saas.public_url && (
            <a href={saas.public_url} target="_blank" rel="noopener" className="btn-primary mt-6">
              Open app ↗
            </a>
          )}
        </div>
      </header>

      {desc && (
        <section className="prose prose-neutral mt-10 max-w-3xl">
          <h2 className="font-display text-xl font-bold">About</h2>
          <p className="whitespace-pre-wrap">{desc}</p>
        </section>
      )}

      {saas.saas_plans && saas.saas_plans.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-bold">Plans</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-4">
            {saas.saas_plans.map((p: any) => (
              <div key={p.name} className="card p-6">
                <div className="font-semibold">{p.name}</div>
                <div className="mt-2 font-display text-2xl">
                  {p.price_jpy === 0 ? 'Free' : `¥${p.price_jpy.toLocaleString()}/mo`}
                </div>
                <SubscribeButton saasId={saas.id} planName={p.name} disabled={p.price_jpy === 0} />
              </div>
            ))}
          </div>
        </section>
      )}

      {recs.length > 0 && (
        <section className="mt-16">
          <h2 className="font-display text-xl font-bold">You might also like</h2>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-6">
            {recs.filter((r: any) => r.id !== saas.id).map((s: any) => (
              <SaasCard key={s.id} saas={s} locale={locale} />
            ))}
          </div>
        </section>
      )}

      {/* JSON-LD for SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name,
            description: tagline,
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            offers: (saas.saas_plans ?? []).map((p: any) => ({
              '@type': 'Offer',
              name: p.name,
              price: p.price_jpy,
              priceCurrency: 'JPY',
            })),
          }),
        }}
      />
    </article>
  );
}
