import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://puente-saas.com'),
  title: { default: 'Punete Micro SaaS Store', template: '%s | Punete' },
  description: '3日でローンチ。AIがあなたのアイディアをSaaSにする。株式会社プエンテが運営する Micro SaaS マーケットプレイス。',
  alternates: {
    languages: {
      ja: 'https://puente-saas.com/ja',
      en: 'https://puente-saas.com/en',
    },
  },
  openGraph: {
    type: 'website',
    siteName: 'Punete Micro SaaS Store',
    images: ['/og-default.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
