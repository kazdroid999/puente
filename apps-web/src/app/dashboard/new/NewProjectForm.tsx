'use client';
import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

export default function NewProjectForm() {
  const [form, setForm] = useState({
    company_id: '',
    name: '',
    slug: '',
    category: 'business',
    tagline: '',
    overview: '',
    target_users: '',
    features: '',
  });
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<any>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    const sb = createClient();
    const { data: { session } } = await sb.auth.getSession();
    const brief = {
      name: form.name,
      tagline: form.tagline,
      category: form.category,
      overview: form.overview,
      target_users: form.target_users,
      features: form.features.split('\n').filter(Boolean),
    };
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${session?.access_token}` };
    const createRes = await fetch(`${process.env.NEXT_PUBLIC_API_ORIGIN}/api/saas`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        company_id: form.company_id,
        slug: form.slug,
        name: form.name,
        category: form.category,
        tagline: form.tagline,
        brief,
      }),
    });
    const created = await createRes.json();
    if (!createRes.ok) {
      setStatus('error');
      setResult(created);
      return;
    }
    const analyzeRes = await fetch(`${process.env.NEXT_PUBLIC_API_ORIGIN}/api/saas/${created.saas.id}/analyze`, {
      method: 'POST',
      headers,
    });
    const plan = await analyzeRes.json();
    setResult({ saas: created.saas, plan: plan.plan });
    setStatus('done');
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-4">
      <Field label="会社ID" value={form.company_id} onChange={(v) => setForm({ ...form, company_id: v })} required mono />
      <Field label="サービス名" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
      <Field label="スラッグ (英小文字 + ハイフン)" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} required mono />
      <div>
        <label className="text-sm font-medium">カテゴリ</label>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          className="mt-2 w-full rounded-lg border border-line px-3 py-2"
        >
          <option value="business">ビジネス</option>
          <option value="learning">学習</option>
          <option value="entertainment">エンタメ</option>
          <option value="infra">インフラ</option>
        </select>
      </div>
      <Field label="タグライン (一行)" value={form.tagline} onChange={(v) => setForm({ ...form, tagline: v })} />
      <Area label="サービス概要" value={form.overview} onChange={(v) => setForm({ ...form, overview: v })} />
      <Area label="ターゲットユーザー" value={form.target_users} onChange={(v) => setForm({ ...form, target_users: v })} />
      <Area label="欲しい機能 (1行1機能)" value={form.features} onChange={(v) => setForm({ ...form, features: v })} />
      <div className="flex justify-end">
        <button type="submit" disabled={status === 'submitting'} className="btn-primary disabled:opacity-50">
          {status === 'submitting' ? 'AI解析中…(最大30秒)' : '送信してAI解析'}
        </button>
      </div>

      {status === 'done' && result?.plan && (
        <div className="card mt-6 p-6">
          <h3 className="font-semibold">AI 事業計画</h3>
          <pre className="mt-2 whitespace-pre-wrap text-xs">{JSON.stringify(result.plan, null, 2)}</pre>
          <p className="mt-4 text-sm text-muted">
            Puente 承認 → ボリビアチーム開発 → プレビューURL ダッシュボード通知（1〜3日）
          </p>
        </div>
      )}
      {status === 'error' && (
        <p className="text-sm text-danger">エラー: {JSON.stringify(result)}</p>
      )}
    </form>
  );
}

function Field({ label, value, onChange, required, mono }: any) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={`mt-2 w-full rounded-lg border border-line px-3 py-2 ${mono ? 'font-mono' : ''}`}
      />
    </div>
  );
}
function Area({ label, value, onChange }: any) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="mt-2 w-full rounded-lg border border-line px-3 py-2"
      />
    </div>
  );
}
