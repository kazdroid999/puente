// Supabase client (anon key + SECURITY DEFINER RPCs for privileged ops)
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './types';

/** Anon-level client — use for RLS-protected reads/writes */
export function sb(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Authenticated client — pass user's JWT for RLS context */
export function sbAuth(env: Env, token: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Bearer JWT から auth.uid() を取得
export async function getUserId(env: Env, authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const client = sbAuth(env, token);
  const { data } = await client.auth.getUser(token);
  return data.user?.id ?? null;
}

export async function isSuperAdmin(env: Env, userId: string): Promise<boolean> {
  const { data } = await sb(env).from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'super_admin';
}
