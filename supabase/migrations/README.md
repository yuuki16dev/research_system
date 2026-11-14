# Supabase マイグレーション適用手順

Supabase ダッシュボードの **SQL Editor** で、以下のファイル名順（昇順）に手動実行してください。

## 1. 適用順

1. `20261106_init.sql` — 初期テーブル (`profiles`, `research_usage`, `user_reports`)、RLS、新規ユーザー登録トリガー
2. `20261111_lock_profile_plan.sql` — `profiles` の利用者自身による UPDATE ポリシー削除（プラン改ざん防止）
3. `20261111_user_reports_schema.sql` — `user_reports` 拡張列 (`pinned`, `updated_at`, `share_token`, `share_enabled`)・インデックス・UPDATE RLS 追加
4. `20261112_credits_schema.sql` — `research_usage` クレジット消費管理のコメント更新
5. `20261112_usage_events_schema.sql` — `usage_events` テーブル・インデックス・RLS 有効化
6. `20261113_credit_functions.sql` — 原子的クレジット確保・返却 RPC (`consume_credits`, `refund_credits`) と `service_role` 権限付与
7. `20261113_usage_cost_since.sql` — 日次原価集計 RPC (`usage_cost_since`) と `service_role` 権限付与
8. `20261114_lock_user_reports_writes.sql` — `user_reports` の利用者向け INSERT / UPDATE / DELETE RLS ポリシー削除（閲覧のみ維持）

---

## 2. 適用済みを確認する SQL

SQL Editor で以下を実行し、必要なテーブル列・関数・権限がすべて揃っていることを確認してください。

### 2-1. テーブルと必須列の確認

```sql
WITH expected(table_name, column_name) AS (
  VALUES
    ('profiles', 'id'),
    ('profiles', 'plan'),
    ('profiles', 'subscription_status'),
    ('research_usage', 'user_id'),
    ('research_usage', 'year_month'),
    ('research_usage', 'used_count'),
    ('user_reports', 'id'),
    ('user_reports', 'user_id'),
    ('user_reports', 'report_json'),
    ('user_reports', 'pinned'),
    ('user_reports', 'updated_at'),
    ('user_reports', 'share_token'),
    ('user_reports', 'share_enabled'),
    ('usage_events', 'user_id'),
    ('usage_events', 'kind'),
    ('usage_events', 'job_id'),
    ('usage_events', 'est_cost_jpy'),
    ('usage_events', 'status'),
    ('usage_events', 'created_at')
)
SELECT
  e.table_name,
  e.column_name,
  (c.column_name IS NOT NULL) AS exists_in_db
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = e.table_name
 AND c.column_name = e.column_name
ORDER BY exists_in_db ASC, e.table_name, e.column_name;
```

全行で `exists_in_db = true` であればテーブル・列は正常です。

### 2-2. RPC 関数と実行権限の確認

```sql
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_exec,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('consume_credits', 'refund_credits', 'usage_cost_since')
ORDER BY p.proname;
```

3行すべてが表示され、`service_role_exec = true`、`authenticated_exec = false`、`anon_exec = false` であれば正常です。

### 2-3. profiles 更新ポリシー削除の確認 (`20261111_lock_profile_plan.sql`)

```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles';
```

`FOR SELECT` のみが残り、`UPDATE` ポリシーが削除されていれば正常です。

### 2-4. user_reports 書き込みポリシー削除の確認 (`20261114_lock_user_reports_writes.sql`)

```sql
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_reports';
```

`SELECT` ポリシー（「ユーザーは自身のリサーチ履歴のみ閲覧可能」）のみが残り、`INSERT` / `UPDATE` / `DELETE` ポリシーがすべて削除されていれば正常です。

