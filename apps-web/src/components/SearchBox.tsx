'use client';
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window { pagefind?: any }
}

export default function SearchBox() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const pf = useRef<any>(null);

  useEffect(() => {
    (async () => {
      // @ts-ignore
      pf.current = await import(/* webpackIgnore: true */ '/pagefind/pagefind.js');
    })().catch(() => {});
  }, []);

  useEffect(() => {
    if (!q || !pf.current) return setResults([]);
    let canceled = false;
    (async () => {
      const r = await pf.current.search(q);
      const data = await Promise.all(r.results.slice(0, 8).map((x: any) => x.data()));
      if (!canceled) setResults(data);
    })();
    return () => { canceled = true };
  }, [q]);

  return (
    <div className="w-full max-w-xl">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="アプリを検索..."
        className="w-full rounded-full border border-line bg-surface px-5 py-3"
      />
      {results.length > 0 && (
        <ul className="mt-3 card divide-y divide-line">
          {results.map((r, i) => (
            <li key={i} className="p-3 hover:bg-bg">
              <a href={r.url}>
                <div className="font-medium">{r.meta?.title ?? r.url}</div>
                <div className="text-sm text-muted" dangerouslySetInnerHTML={{ __html: r.excerpt }} />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
