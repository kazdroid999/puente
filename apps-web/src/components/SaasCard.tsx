import Link from 'next/link';
import Image from 'next/image';

type Saas = {
  id: string;
  slug: string;
  name: string;
  tagline?: string | null;
  category: string;
  square_image_url?: string | null;
};

export default function SaasCard({ saas, locale = 'ja' }: { saas: Saas; locale?: string }) {
  const base = locale === 'ja' ? '' : `/${locale}`;
  return (
    <Link
      href={`${base}/apps/${saas.category}/${saas.slug}`}
      className="group card overflow-hidden transition hover:border-ink"
    >
      <div className="aspect-square bg-line relative">
        {saas.square_image_url ? (
          <Image src={saas.square_image_url} alt={saas.name} fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center font-display text-3xl text-muted">
            {saas.name[0]}
          </div>
        )}
      </div>
      <div className="p-4">
        <div className="text-xs uppercase tracking-wide text-accent">{saas.category}</div>
        <div className="mt-1 font-semibold group-hover:text-accent">{saas.name}</div>
        {saas.tagline && <p className="mt-1 text-sm text-muted line-clamp-2">{saas.tagline}</p>}
      </div>
    </Link>
  );
}
