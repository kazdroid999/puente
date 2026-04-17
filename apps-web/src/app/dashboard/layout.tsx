import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect('/login?next=/dashboard');
  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed left-0 top-0 h-full w-56 border-r border-line bg-surface p-6">
        <Link href="/" className="font-display text-lg font-bold">Punete</Link>
        <nav className="mt-8 flex flex-col gap-2 text-sm">
          <Link href="/dashboard">概要</Link>
          <Link href="/dashboard/new">企画投稿</Link>
          <Link href="/dashboard/revenue">売上</Link>
          <Link href="/dashboard/invoice">インボイス登録番号</Link>
          <Link href="/dashboard/connect">Stripe Connect</Link>
        </nav>
      </aside>
      <main className="ml-56 p-10">{children}</main>
    </div>
  );
}
