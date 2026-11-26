-- ======================================================================
-- S-2: クラウド版ユーザープロフィール設定の永続化列追加
-- Render 等の揮発性ディスク依存を解消し、profiles テーブルへ JSONB 保存する
-- ======================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS profile_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
