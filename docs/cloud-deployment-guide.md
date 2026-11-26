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
  - **復旧手順**:
    1. [Supabase ダッシュボード](https://supabase.com/dashboard) を開き、対象プロジェクトが `Paused` になっていれば **「Resume project」**（または Restore）をクリックします。
    2. 復旧完了後、Render ダッシュボードの **「Manual Deploy」➔「Deploy latest commit」** を実行します。
  - **自動一時停止を防ぐ仕組み（Keep-Alive / v2.19.0〜）**:
    - **方式 1（自動・設定不要）**: `GET /api/health` が外部監視（cron-job.org 等）から呼ばれた際、本番クラウド環境では **24時間に最大1回だけ** バックグラウンドで軽量な DB 照会（`profiles?select=id&limit=1`）を自動実行し、無操作タイマーをリセットします。
    - **方式 2（専用エンドポイント）**: `GET /api/health/db` を呼び出すと、6時間クールダウン付きで Supabase DB 到達性と Keep-Alive クエリを実行できます。
    - **方式 3（GitHub Actions 定期実行・`.github/workflows/supabase-keepalive.yml`）**: リポジトリの Variables に `KEEPALIVE_HEALTH_URL`（例: Render の URL）、または Secrets に `SUPABASE_URL` と `SUPABASE_ANON_KEY` を設定すると、2日に1回自動で Keep-Alive が実行されます。
- **原因 2: Render の `SUPABASE_URL` 誤設定・削除済みプロジェクト**
  - Render の **Environment** で `SUPABASE_URL` が `https://<project-ref>.supabase.co` と一致しているか確認してください（前後空白や引用符、誤って末尾に `/rest/v1/` を付けた場合はアプリ側で自動正規化されますが、ホスト名自体は正確である必要があります）。

### 3.2 `Supabase DB の起動時検証に失敗しました。不足または接続エラー項目: ...` と表示される
- クラウド起動時（`R-7`）に必須テーブル・列（`profiles`, `research_usage`, `user_reports`, `usage_events`）および RPC 関数（`consume_credits`, `refund_credits`, `usage_cost_since`）の存在を検証しています。
- 名前が列挙された項目について、`supabase/migrations/` 内の未適用 SQL マイグレーションファイルを Supabase の **SQL Editor** で順番に実行してください。
- `HTTP 401` / `HTTP 403` が表示される場合は、Render 環境変数 `SUPABASE_SERVICE_ROLE_KEY` の設定値を確認してください。

### 3.3 `render.yaml` の変更が既存 Render サービスに反映されない
- `render.yaml` の `autoDeploy: false` や既定環境変数は、新規 Blueprint デプロイ時にのみ初期設定として参照されます。すでに Render ダッシュボード上で作成済みの Web Service では、Render ダッシュボードの **Settings（Build & Deploy）** および **Environment** 画面から直接設定を確認・更新してください。

### 3.4 Render Free プランの 15 分スリープを防ぎ連続起動を維持する（UptimeRobot / cron-job.org）
- Render の **Free プラン** は約 15 分間アクセスがないと自動でスリープ（スピンダウン）します。GitHub Actions の `supabase-keepalive.yml`（2日に1回）は Supabase の 7 日間自動停止防止用であり、Render の 15 分スリープは防げません。
- **事前注意（月 750 時間の上限）**: Render Free プランは同一アカウント内の全 Free Web Service 合計で月 750 時間が上限です。
  - Render Free のアプリが **Research Studio のみ** の場合：24 時間 × 31 日 ＝ **744 時間 ≦ 750 時間** のため、24 時間連続起動しても無料枠に収まります。
  - **他にも Free Web Service がある場合**：24 時間稼働にすると月途中で上限に達するため、`cron-job.org` 等で利用時間帯（例：JST 7:00〜24:00）のみ実行してください。
- **監視対象 URL（共通）**: `https://<あなたのRenderドメイン>/api/health`
  - `/api/health` は `GET` / `HEAD` ともに即座に `200 OK` を返し、かつ 24 時間に最大 1 回だけ裏側で Supabase Keep-Alive クエリも自動実行するため、これ 1 本で Render と Supabase の両方を維持できます。
- **方法 1：UptimeRobot（24 時間常時起動向け・推奨）**
  1. [UptimeRobot](https://uptimerobot.com/)（Free プラン）で `HTTP(s)` モニターを作成する。
  2. URL に `https://<あなたのRenderドメイン>/api/health`、監視間隔に `5 minutes` を指定する。
  3. 一時的なデプロイエラーやコールドスタートで自動停止（Disabled）されず、復旧後に自動で通常監視へ戻ります。
- **方法 2：cron-job.org（時間帯指定したい場合）**
  1. [cron-job.org](https://cron-job.org/) で `GET https://<あなたのRenderドメイン>/api/health` を 10 分間隔（必要に応じて `Asia/Tokyo` の利用時間帯のみ）で登録する。
  2. **Request timeout** は最大値（`30` 秒）に設定し、**連続失敗による自動無効化通知（Disable notification）** を必ず ON にしてください。
- **動作確認方法**: 設定から 20〜30 分後に `/api/health` を開き、レスポンス JSON の `"uptime"` が `1200`（20 分）以上に増え続けていれば、15 分スリープを回避して連続起動できています。



