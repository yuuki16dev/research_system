# ☁️ Research Studio クラウド移行・デプロイ完全ガイド

本ガイドは、Research Studio を Render（Webサーバー）および Supabase（認証・DB）にデプロイし、ご自身のPCを起動しなくてもブラウザから常時利用できるようにするための手順書です。

---

## 1. 事前確認: Supabase & Render のプロジェクト数制限

### 1.1 Supabase の無料枠（Free Tier）制限
- **アクティブプロジェクト数**: **最大 2 つまで**
- **過去に利用したプロジェクトがある場合**:
  - Supabase ダッシュボード（https://supabase.com/dashboard）を開きます。
  - すでに2つプロジェクトがある場合、使用していない古いプロジェクトを **「Settings」➔「Pause project（一時停止）」** または **「Delete project（削除）」** してください。
  - 空きができれば、新規プロジェクト（例: `research-studio-db`）を完全無料で作成できます。
  - ※データベースは 500MB まで無料、月間 100,000 人の認証ユーザーまで無料です。

### 1.2 Render のプロジェクト（Web Service）制限
- 今回推奨の **Starter Web Service（$7/月・常時稼働）** を契約する場合、無料枠の時間制限（月750時間共有）とは無関係に、独立した専用リソースとして24時間365日スリープなしで動作します。

---

## 2. デプロイ手順（3ステップ）

### ステップ 1: Supabase のセットアップ（約3分）
1. Supabase で新規プロジェクトを作成（Database Password を控えておく）。
2. プロジェクト画面左メニューの **「SQL Editor」** を開く。
3. リポジトリ内の [`supabase/migrations/20261106_init.sql`](../supabase/migrations/20261106_init.sql) の内容をすべて貼り付けて、右下の **「Run」** をクリック。
   - ➔ `profiles`（ユーザー情報・プラン）、`research_usage`（月間利用回数）、`user_reports`（履歴保存）テーブルが自動作成されます。
4. 左メニュー **「Project Settings」➔「API」** から以下をコピーして控える：
   - **Project URL**（例: `https://xxxx.supabase.co`）
   - **anon public API key**
   - **service_role secret API key**

### ステップ 2: Render へのデプロイ（約2分）
1. Render ダッシュボード（https://dashboard.render.com/）を開く。
2. 右上の **「New +」➔「Web Service」** を選択。
3. GitHub リポジトリ（`yuuki16dev/research_system`）を選択して接続。
4. 設定画面で以下を確認・指定：
   - **Name**: `research-studio`
   - **Runtime**: `Docker`
   - **Instance Type**: `Starter` ($7/month)
5. **「Environment Variables（環境変数）」** に以下を追加：
   | KEY | VALUE | 説明 |
   | :--- | :--- | :--- |
   | `PORT` | `3939` | サーバー待受ポート |
   | `NODE_ENV` | `production` | 本番環境指定 |
   | `GEMINI_API_KEY` | `AIzaSy...` | ご自身のGoogle Gemini APIキー |
   | `TAVILY_API_KEY` | `tvly-...` | ご自身のTavily APIキー |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` | ステップ1で取得したURL |
   | `SUPABASE_ANON_KEY` | `eyJhbGci...` | ステップ1で取得したanonキー |
   | `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGci...` | ステップ1で取得したservice_roleキー |
6. **「Create Web Service」** をクリック。
   - ➔ 自動的に Docker ビルドが走り、約2〜3分で `https://research-studio-xxxx.onrender.com` が発行されて常時稼働が開始します！

### ステップ 3: 動作確認
- 発行された Render の URL にブラウザでアクセスします。
- これで、ご自身のPCを立ち上げなくても、外出先やスマートフォンからでもいつでも快適にリサーチを実行できます！

### ステップ 4: GitHub Webhook (Deploy Hook) による完全自動デプロイ
1. Render の「Settings」画面で「Deploy Hook」の URL をコピーします。
2. GitHub リポジトリの「Settings ➔ Webhooks」で「Add webhook」をクリックします。
3. Payload URL に Render の Deploy Hook URL を貼り付け、Content type を `application/json` に設定して登録します。
4. これにより、今後は `git push origin main` を行うだけで、GitHub から Render へ直接デプロイ命令が送信され、100% 確実に自動デプロイが実行されます。

---

## 3. トラブルシューティング（Render / Supabase）

### 3.1 `getaddrinfo ENOTFOUND xxxx.supabase.co` で起動に失敗する
- **原因 1（最も多い）: Supabase Free プランの自動停止（Paused）**
  - Supabase 無料プランでは、約 7 日間データベースへのアクセスがないとプロジェクトが自動的に **Paused（一時停止）** 状態になり、`*.supabase.co` の DNS 解決自体も停止（`ENOTFOUND`）します。
  - **対処法**:
    1. [Supabase ダッシュボード](https://supabase.com/dashboard) を開き、対象プロジェクトが `Paused` になっていれば **「Resume project」**（または Restore）をクリックします。
    2. 復旧完了後、Render ダッシュボードの **「Manual Deploy」➔「Deploy latest commit」** を実行します。
- **原因 2: Render の `SUPABASE_URL` 誤設定・削除済みプロジェクト**
  - Render の **Environment** で `SUPABASE_URL` が `https://<project-ref>.supabase.co` と一致しているか確認してください（前後空白や引用符、誤って末尾に `/rest/v1/` を付けた場合はアプリ側で自動正規化されますが、ホスト名自体は正確である必要があります）。

### 3.2 `Supabase DB の起動時検証に失敗しました。不足または接続エラー項目: ...` と表示される
- クラウド起動時（`R-7`）に必須テーブル・列（`profiles`, `research_usage`, `user_reports`, `usage_events`）および RPC 関数（`consume_credits`, `refund_credits`, `usage_cost_since`）の存在を検証しています。
- 名前が列挙された項目について、`supabase/migrations/` 内の未適用 SQL マイグレーションファイルを Supabase の **SQL Editor** で順番に実行してください。
- `HTTP 401` / `HTTP 403` が表示される場合は、Render 環境変数 `SUPABASE_SERVICE_ROLE_KEY` の設定値を確認してください。

### 3.3 `render.yaml` の変更が既存 Render サービスに反映されない
- `render.yaml` の `autoDeploy: false` や既定環境変数は、新規 Blueprint デプロイ時にのみ初期設定として参照されます。すでに Render ダッシュボード上で作成済みの Web Service では、Render ダッシュボードの **Settings（Build & Deploy）** および **Environment** 画面から直接設定を確認・更新してください。


