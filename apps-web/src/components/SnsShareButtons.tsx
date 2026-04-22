'use client';

/**
 * SNS 投稿ボタン（公開 SaaS 詳細ページ用）
 * - ダッシュボードの ShareCard と媒体ラインナップを揃える
 * - utm_source でどの媒体からの流入か計測できるようにする
 */

type Platform = {
  key: string;
  label: string;
  urlFn: (text: string, link: string) => string;
};

const PLATFORMS: Platform[] = [
  {
    key: 'x',
    label: 'X',
    urlFn: (text, link) =>
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(link)}`,
  },
  {
    key: 'threads',
    label: 'Threads',
    urlFn: (text, link) =>
      `https://www.threads.net/intent/post?text=${encodeURIComponent(`${text}\n${link}`)}`,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    urlFn: (_text, link) =>
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    urlFn: (_text, link) =>
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`,
  },
  {
    key: 'note',
    label: 'note',
    urlFn: (text, link) =>
      `https://note.com/intent/post?text=${encodeURIComponent(`${text}\n${link}`)}`,
  },
  {
    key: 'hatebu',
    label: 'はてブ',
    urlFn: (_text, link) =>
      `https://b.hatena.ne.jp/entry/panel/?url=${encodeURIComponent(link)}`,
  },
];

export default function SnsShareButtons({
  url,
  text,
}: {
  url: string;
  text: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-muted mb-2">Share</div>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => {
          const linkWithUtm = `${url}${url.includes('?') ? '&' : '?'}utm_source=${p.key}&utm_medium=visitor_share`;
          return (
            <a
              key={p.key}
              href={p.urlFn(text, linkWithUtm)}
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
  );
}
