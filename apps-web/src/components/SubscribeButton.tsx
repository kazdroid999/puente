'use client';
import { useState } from 'react';

export default function SubscribeButton({
  saasId,
  planName,
  disabled = false,
}: {
  saasId: string;
  planName: string;
  disabled?: boolean;
}) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  if (disabled) return <div className="mt-4 text-sm text-muted">無料プランはサインアップ後に有効化されます。</div>;

  async function subscribe() {
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_ORIGIN}/public/saas/${saasId}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          plan_name: planName,
          email,
          success_url: window.location.href + '?sub=success',
          cancel_url: window.location.href + '?sub=cancel',
        }),
      });
      const json = await res.json();
      if (json.url) window.location.href = json.url;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <input
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="rounded-lg border border-line px-3 py-2 text-sm"
      />
      <button onClick={subscribe} disabled={!email || loading} className="btn-primary text-sm disabled:opacity-50">
        {loading ? '...' : '登録する'}
      </button>
    </div>
  );
}
