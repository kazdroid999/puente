import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function Footer({ locale }: { locale: string }) {
  const t = await getTranslations({ locale });
  return (
    <footer className="mt-24 border-t border-line bg-surface">
      <div className="container-pad grid gap-8 py-12 md:grid-cols-4">
        <div>
          <div className="font-display text-lg font-bold">Punete Micro SaaS Store</div>
          <p className="mt-2 text-sm text-muted">
            © 2026 {t('footer.company')}<br />
            〒359-1106 埼玉県所沢市東狭山ヶ丘2-2951-44
          </p>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-medium">Product</div>
          <ul className="space-y-1 text-muted">
            <li><Link href="/apps">Store</Link></li>
            <li><Link href="/apps/editorial">Editorial</Link></li>
            <li><Link href="/pricing">Pricing</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-medium">Legal</div>
          <ul className="space-y-1 text-muted">
            <li><Link href="/terms">{t('footer.terms')}</Link></li>
            <li><Link href="/privacy">{t('footer.privacy')}</Link></li>
            <li><Link href="/tokushoho">{t('footer.tokushoho')}</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-2 font-medium">Contact</div>
          <ul className="space-y-1 text-muted">
            <li><a href="https://www.puentework.com" target="_blank" rel="noopener">puentework.com</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
