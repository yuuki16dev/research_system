-- ======================================================================
-- Research Studio — usage_events スキーマ定義 (C-3)
-- 目的: リサーチ・対話・スライド生成の消費クレジット・コストをユーザー別に記録
-- ======================================================================

CREATE TABLE IF NOT EXISTS public.usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'research_quick' | 'research_deep' | 'cross' | 'delta' | 'deepdive' | 'slides'
  job_id TEXT,
  model TEXT,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  gemini_calls INTEGER NOT NULL DEFAULT 0,
  tavily_credits INTEGER NOT NULL DEFAULT 0,
  est_cost_jpy NUMERIC(10, 4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'done', -- 'done' | 'error' | 'cancelled'
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 利用者別・期間別の集計高速化用インデックス
CREATE INDEX IF NOT EXISTS idx_usage_events_user_created
  ON public.usage_events (user_id, created_at DESC);

-- RLS (Row Level Security) 有効化
-- 利用者向けのポリシーは作成せず、Service Role (サーバーサイド) のみが読み書きを行う
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

