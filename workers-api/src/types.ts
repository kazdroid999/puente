// Punete Micro SaaS Store — Workers API / 型定義
// Cloudflare Workers Env bindings

export interface Env {
  ENVIRONMENT: string;
  APP_ORIGIN: string;
  API_ORIGIN: string;
  ANTHROPIC_API_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_CONNECT_CLIENT_ID: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  RESEND_API_KEY: string;
  PRTIMES_API_KEY?: string;
}

export type SaasStatus =
  | 'draft' | 'ai_analyzing' | 'pending_approval' | 'approved'
  | 'in_development' | 'ready_for_review' | 'preview' | 'published'
  | 'paused' | 'archived' | 'rejected';

export type SaasCategory = 'business' | 'learning' | 'entertainment' | 'infra';

export interface SaasBrief {
  name: string;
  tagline?: string;
  category: SaasCategory;
  overview: string;
  target_users: string;
  features: string[];
  revenue_model?: string;
  references?: string[];
}

export interface AiPlan {
  executive_summary: string;
  target_market: { persona: string; pain: string; tam_jpy: number };
  core_features: { name: string; description: string; priority: 'P0' | 'P1' | 'P2' }[];
  tech_stack: {
    frontend: string;
    backend: string;
    db: string;
    hosting: string;
    auth: string;
    payments: string;
  };
  bep: {
    monthly_fixed_cost_jpy: number;
    avg_arpu_jpy: number;
    break_even_mrr_jpy: number;
    break_even_users: number;
  };
  risks: string[];
  kpis: string[];
  roadmap_3day: { day: 1 | 2 | 3; tasks: string[] }[];
}
