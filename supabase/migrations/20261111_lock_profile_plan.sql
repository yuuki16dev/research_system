-- ======================================================================
-- Research Studio — Supabase Cloud Database Security Patch (Review H3)
-- 目的: 利用者が自身の UPDATE で plan を改ざんできないよう
--       profiles に対する更新ポリシーを削除し、service_role のみ更新可能にする
-- ======================================================================

-- ユーザー自身による profiles の更新ポリシーを削除
DROP POLICY IF EXISTS "ユーザーは自身のプロファイルを更新可能" ON public.profiles;

-- 閲覧ポリシーは維持（ユーザーは自身の plan, subscription_status 等を閲覧可能）
-- SELECT USING (auth.uid() = id);

