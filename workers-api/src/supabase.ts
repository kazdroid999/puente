// Supabase client (anon key + SECURITY DEFINER RPCs for privileged ops)
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { Env } from './types';

/** Anon-level client — use for RLS-protected reads/writes */
export function sb(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Service-role client — bypasses RLS, use for admin queries and auth.admin.* calls */
export function sbAdmin(env: Env): SupabaseClient {
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  return createClient(env.SUPABASE_URL, key, {
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

/** JWT トークンを取得（auth header から） */
export function getToken(authHeader: string | null): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/** ユーザー認証済みの Supabase クライアント（RLS が auth.uid() で動作する） */
export function sbUser(env: Env, authHeader: string | null): SupabaseClient {
  const token = getToken(authHeader);
  if (!token) return sb(env); // fallback to anon
  return sbAuth(env, token);
}

export async function isSuperAdmin(env: Env, userId: string): Promise<boolean> {
  // profiles の SELECT RLS が `auth.uid() = id OR is_admin()` のため、anonクライアントでは
  // auth.uid() が null になり自分以外の role が読めない。結果として常に false が返る。
  // service_role クライアント (sbAdmin) で RLS をバイパスして role を直接取得する。
  const { data } = await sbAdmin(env).from('profiles').select('role').eq('id', userId).single();
  return data?.role === 'super_admin';
}
