import type { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase-server';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sb = createClient();
  const { data } = await sb
    .from('saas_projects')
    .select('slug,category,updated_at')
    .eq('status', 'published');
  const base = 'https://puente-saas.com';
  const staticPages = ['', '/apps', '/apps/editorial', '/pricing', '/terms', '/privacy', '/tokushoho'];
  const entries: MetadataRoute.Sitemap = [];
  for (const p of staticPages) {
    entries.push({ url: `${base}${p}`, changeFrequency: 'weekly', priority: p === '' ? 1 : 0.7, alternates: { languages: { ja: `${base}${p}`, en: `${base}/en${p}` } } });
  }
  for (const s of data ?? []) {
    const path = `/apps/${s.category}/${s.slug}`;
    entries.push({
      url: `${base}${path}`,
      lastModified: s.updated_at,
      changeFrequency: 'daily',
      priority: 0.8,
      alternates: { languages: { ja: `${base}${path}`, en: `${base}/en${path}` } },
    });
  }
  return entries;
}
