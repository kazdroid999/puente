'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

type Company = {
  id: string;
  legal_name: string;
  invoice_registration_number: string | null;
  is_invoice_registered: boolean;
};

export default function InvoiceForm({ company }: { company: Company }) {
  const [number, setNumber] = useState(company.invoice_registration_number ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setStatus('saving');
    setErr(null);
    if (number && !/^T\d{13}$/.test(number)) {
      setErr('T + 13桁の形式で入力してください（例: T1234567890123）');
      setStatus('error');
      return;
    }
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_ORIGIN}/api/companies/${company.id}/invoice`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session?.access_token}`,
      },
      body: JSON.stringify({ invoice_registration_number: number || null }),
    });
    if (res.ok) setStatus('saved');
    else {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? 'failed');
      setStatus('error');
    }
  }

  return (
    <div className="card p-6">
      <div className="font-semibold">{company.legal_name}</div>
      <label className="mt-4 block text-sm font-medium">登録番号 (T + 13桁)</label>
      <input
        value={number}
        onChange={(e) => setNumber(e.target.value.trim().toUpperCase())}
        placeholder="T1234567890123"
        maxLength={14}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2 font-mono"
      />
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
      {status === 'saved' && <p className="mt-2 text-sm text-success">保存しました。</p>}
      <div className="mt-4 flex justify-end">
        <button onClick={save} disabled={status === 'saving'} className="btn-primary disabled:opacity-50">
          {status === 'saving' ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}
