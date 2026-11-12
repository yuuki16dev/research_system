-- ======================================================================
-- Research Studio — user_reports スキーマ拡張 (B-2, B-5)
-- 実行方法: Supabase ダッシュボード > SQL Editor に貼り付けて「RUN」を実行
-- ======================================================================

-- 1. 不足している列を追加 (pinned, updated_at, share_token, share_enabled)
ALTER TABLE public.user_reports
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
  ADD COLUMN IF NOT EXISTS share_token TEXT,
  ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT false;

-- 2. 検索・ソート用インデックス
CREATE INDEX IF NOT EXISTS idx_user_reports_user_pinned
  ON public.user_reports (user_id, pinned DESC, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_reports_share_token
  ON public.user_reports (share_token)
  WHERE share_token IS NOT NULL;

-- 3. RLS ポリシー (UPDATE 追加)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_reports'
      AND policyname = 'ユーザーは自身のリサーチ履歴を更新可能'
  ) THEN
    CREATE POLICY "ユーザーは自身のリサーチ履歴を更新可能"
      ON public.user_reports FOR UPDATE
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

