'use client';
import { useEffect, useState } from 'react';

const PLATFORMS = [
  { key: 'x', label: 'X', urlFn: (text: string, link: string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}` },
  { key: 'threads', label: 'Threads', urlFn: (text: string, link: string) => `https://www.threads.net/intent/post?text=${encodeURIComponent(text + '\n' + link)}` },
  { key: 'facebook', label: 'Facebook', urlFn: (_t: string, link: string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}` },
  { key: 'linkedin', label: 'LinkedIn', urlFn: (_t: string, link: string) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}` },
  { key: 'note', label: 'note', urlFn: (text: string, link: string) => `https://note.com/intent/post?text=${encodeURIComponent(text + '\n' + link)}` },
  { key: 'hatebu', label: 'はてブ', urlFn: (_t: string, link: string) => `https://b.hatena.ne.jp/entry/panel/?url=${encodeURIComponent(link)}` },
] as const;

export default function ShareCard({ saas, stat }: { saas: any; stat: any }) {
  const [kit, setKit] = useState<any>(null);
  useEffect(() => {
    fetch(`/api/internal/share-kit?saas_id=${saas.id}`).then((r) => r.json()).then(setKit);
  }, [saas.id]);

  const ref = stat?.company_id ?? '';
  const linkBase = `https://puente-saas.com/apps/${saas.category}/${saas.slug}?ref=${ref}&utm_source=`;

  return (
    <div className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-bold">{saas.name}</h3>
        <span className="text-xs text-muted">公開中</span>
      </div>
      <p className="mt-1 text-sm text-muted line-clamp-2">{saas.tagline}</p>

      <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
        <div className="rounded-lg border border-line p-2">
          <div className="font-bold text-base">{stat?.click_count_30d ?? 0}</div>
          <div className="text-muted">クリック /30日</div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="font-bold text-base">{stat?.conversion_30d ?? 0}</div>
          <div className="text-muted">獲得 /30日</div>
        </div>
        <div className="rounded-lg border border-line p-2">
          <div className="font-bold text-base">¥{Number(stat?.gmv_30d ?? 0).toLocaleString()}</div>
          <div className="text-muted">GMV /30日</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold mb-2">いまシェア</div>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => {
            const text = (kit?.[`copy_${p.key}`] ?? `${saas.name} — ${saas.tagline}`).replace('{REF}', ref);
            const link = `${linkBase}${p.key}&utm_medium=owner_share`;
            return (
              <a
                key={p.key}
                href={p.urlFn(text, link)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-ink px-3 py-1 text-xs hover:bg-ink hover:text-white"
              >
                {p.label}
              </a>
            );
          })}
        </div>
      </div>

      {kit?.video_vertical_url && (
        <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
          <a href={kit.video_vertical_url} className="rounded border border-line p-2 text-center hover:border-ink" download>9:16 動画 ↓</a>
          <a href={kit.video_square_url} className="rounded border border-line p-2 text-center hover:border-ink" download>1:1 動画 ↓</a>
          <a href={kit.video_landscape_url} className="rounded border border-line p-2 text-center hover:border-ink" download>16:9 動画 ↓</a>
        </div>
      )}

      {kit?.embed_html && (
        <details className="mt-4 text-xs">
          <summary className="cursor-pointer text-muted">埋め込みコード</summary>
          <textarea readOnly className="mt-2 w-full rounded border border-line p-2 font-mono" rows={3} defaultValue={kit.embed_html.replace('{REF}', ref)} />
        </details>
      )}
    </div>
  );
}
