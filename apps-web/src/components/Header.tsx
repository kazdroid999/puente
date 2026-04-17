import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function Header({ locale }: { locale: string }) {
  const t = await getTranslations({ locale });
  const base = locale === 'ja' ? '' : `/${locale}`;
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
      <div className="container-pad flex h-16 items-center justify-between">
        <Link href={`${base}/`} className="flex items-center gap-2 font-display text-lg font-bold">
          <span className="inline-block h-6 w-6 rounded-lg bg-accent" aria-hidden />
          Punete
        </Link>
        <nav className="hidden gap-6 text-sm md:flex">
          <Link href={`${base}/apps`}>{t('nav.store')}</Link>
          <Link href={`${base}/apps/editorial`}>{t('nav.editorial')}</Link>
          <Link href={`${base}/pricing`}>{t('nav.pricing')}</Link>
          <Link href="https://www.puentework.com" target="_blank" rel="noopener">
            {t('nav.about')}
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="btn-ghost text-sm">
            {t('common.dashboard')}
          </Link>
        </div>
      </div>
    </header>
  );
}
