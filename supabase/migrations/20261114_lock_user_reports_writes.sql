-- ======================================================================
-- Research Studio — user_reports 書き込み RLS ポリシー削除 (R-9 #7)
-- 目的: サーバーが service_role で user_reports を操作するため、
--       利用者（authenticated / anon）の INSERT / UPDATE / DELETE ポリシーを削除し、
--       クライアントからの直接書き込み・履歴改ざんを防止する
-- ======================================================================

DROP POLICY IF EXISTS "ユーザーは自身のリサーチ履歴を挿入可能" ON public.user_reports;
DROP POLICY IF EXISTS "ユーザーは自身のリサーチ履歴を更新可能" ON public.user_reports;
DROP POLICY IF EXISTS "ユーザーは自身のリサーチ履歴を削除可能" ON public.user_reports;

-- 閲覧ポリシー（「ユーザーは自身のリサーチ履歴のみ閲覧可能」）は維持
-- SELECT USING (auth.uid() = user_id);

