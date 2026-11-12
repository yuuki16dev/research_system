-- ======================================================================
-- Research Studio — クレジット制への移行マイグレーション (C-4)
-- 目的: research_usage.used_count 列をクレジット消費量として運用
-- ======================================================================

-- 1. research_usage テーブルの列コメントを更新
COMMENT ON TABLE public.research_usage IS 'ユーザーごとの月間クレジット消費管理テーブル (C-4)';
COMMENT ON COLUMN public.research_usage.used_count IS '当月消費された累計クレジット数';

-- 2. profiles テーブルの既定プラン等の整合性確認（存在しない場合）
-- free: 3クレジット, standard: 30クレジット

