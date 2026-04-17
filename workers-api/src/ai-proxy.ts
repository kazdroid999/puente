// ai-proxy.ts — Claude API プロキシ層
// Cloudflare AI Gateway + Prompt Cache + Result Cache (KV) + Batch ルーティング
// 目的: API コストを ¥200K/月 → ¥10K/月 に圧縮
import Anthropic from '@anthropic-ai/sdk';
import type { Env } from './types';

const GATEWAY_BASE = (env: Env) =>
  `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/puente-ai/anthropic`;

// Anthropic SDK を AI Gateway 経由で初期化
export function anthropic(env: Env) {
  return new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: GATEWAY_BASE(env),  // ← Gateway 経由でログ・キャッシュ・分析
  });
}

// ========== Result Cache (KV 24h) ==========
export async function cachedComplete(env: Env, key: string, fn: () => Promise<string>): Promise<string> {
  const cached = await env.KV_CACHE.get(`ai:${key}`);
  if (cached) return cached;
  const result = await fn();
  await env.KV_CACHE.put(`ai:${key}`, result, { expirationTtl: 24 * 3600 });
  return result;
}

// ========== Prompt Cache 付き Sonnet 呼び出し ==========
// system プロンプトを cache_control: 'ephemeral' で 90% off
export async function sonnetWithPromptCache(
  env: Env,
  systemTemplate: string,
  userInput: string,
  maxTokens = 1500,
) {
  const client = anthropic(env);
  return client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: [
      {
        type: 'text',
        text: systemTemplate,
        cache_control: { type: 'ephemeral' },  // ← 共通プロンプトを 5 分キャッシュ
      },
    ],
    messages: [{ role: 'user', content: userInput }],
  });
}

// ========== Haiku 階層化（軽量タスク用） ==========
export async function haikuFast(env: Env, prompt: string, maxTokens = 500) {
  const client = anthropic(env);
  return client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  });
}

// ========== Batch API 投入（50% off） ==========
// SNS コピー生成・動画字幕など非リアルタイム処理を 1 日 1 回 Batch 実行
export async function enqueueBatchJob(env: Env, jobs: { custom_id: string; prompt: string; model?: string }[]) {
  const client = anthropic(env);
  const requests = jobs.map((j) => ({
    custom_id: j.custom_id,
    params: {
      model: j.model ?? 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user' as const, content: j.prompt }],
    },
  }));
  // @ts-ignore - batches API
  return client.messages.batches.create({ requests });
}

// ========== ルーティング判定（モデル選択） ==========
export function pickModel(taskType: 'brief_analysis' | 'sns_copy' | 'caption' | 'monthly_report' | 'index_update'): string {
  switch (taskType) {
    case 'brief_analysis':
    case 'monthly_report':
      return 'claude-sonnet-4-6';
    case 'sns_copy':
    case 'caption':
    case 'index_update':
    default:
      return 'claude-haiku-4-5-20251001';
  }
}

// ========== ハッシュ生成（Result Cache キー用） ==========
export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
