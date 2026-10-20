# 変更履歴 (CHANGELOG)

すべての重要な変更は、このファイルに記録されます。
本プロジェクトは [セマンティック バージョニング (Semantic Versioning)](https://semver.org/lang/ja/) に準拠します。

- **メジャー (X.0.0)**: 後方互換性のない破壊的変更や大規模リニューアル
- **マイナー (1.X.0)**: 後方互換性のある新機能の追加
- **パッチ (1.0.X)**: 後方互換性のあるバグ修正や安定化・改善

---

## [未リリース / 次期バージョン候補: v1.2.0]
- Stage 3（過去レポートの全文検索・タグ付け機能、オフライン復帰UI、UX拡張）を予定。

---

## [v1.1.3] - 2026-10-20

### 🧩 アプリ全体の整合性改善 & バージョン表記の是正 (System Consistency & Version Coherence)
- **`start.bat` / `start.sh` のバージョン表記の明確化**:
  - 「v18以上」という表記がアプリのバージョンなのか実行環境（Node.js）のバージョンなのか判別しにくかった問題を是正。
  - ランチャー先頭に「アプリ本体: Research Studio」「実行環境: Node.js (動作要件: v18以上)」を明確に分離表示し、環境エラー時も「検出された Node.js のバージョン」と「必要な Node.js のバージョン（v18以上）」をわかりやすく表示するように改善。
- **アプリ全体でのバージョン表記の動的統一**:
  - `server/index.js` の `/api/info` で `0.1.0` がハードコードされていた不具合を修正し、`package.json` のバージョン（`1.1.3`）を動的返却するように改修。
  - フロントエンド画面左下のフッター（`public/index.html`）に初期バージョンのまま残っていた `v0.1.0` を修正し、API から受信したバージョンで自動同期される仕組み（`footer-version`）を導入。
  - 「⚙️ 設定」モーダルのヘッダーにも現在のバージョンバッジ（`settings-version-badge`）を表示。
  - `server/start.js` および `server/stop.js` のバナーにも動的バージョン表示を適用。
  - `package-lock.json` のバージョン不整合を `1.1.3` に完全同期。
- **整合性テストの自動化**:
  - [test/consistency.test.js](file:///c:/Users/ojkne/.gemini/antigravity-ide/scratch/research_system/test/consistency.test.js) を新設。`package.json`、`package-lock.json`、`CHANGELOG.md`、HTML フッター、デフォルトポート（3939）の一致を自動テストで継続保証。

---

## [v1.1.2] - 2026-10-20

### 📊 ロギング & 診断機能 (Logging & Diagnostics)
- **包括的なエラーログ・動作ログの自動ファイル永続化**:
  - [server/logger.js](file:///c:/Users/ojkne/.gemini/antigravity-ide/scratch/research_system/server/logger.js) を新設。サーバー起動時からすべての動作を `data/logs/app.log`、警告・エラーを `data/logs/error.log` に自動記録。
  - `console.log`, `console.warn`, `console.error` をインターセプトし、ミリ秒精度のタイムスタンプ付きでファイルへ書き込み。
  - 未処理の例外（`uncaughtException`）や非同期例外（`unhandledRejection`）を確実に捕捉し、プロセス終了直前でもスタックトレースをディスクに同期保存。
  - セキュリティ配慮: Gemini API キー (`AIza...`) や Tavily API キー (`tvly-...`) などの秘密情報を検知し、ログ書き込み前に自動マスキングするフィルターを実装。
  - 新設の単体テスト [test/logger.test.js](file:///c:/Users/ojkne/.gemini/antigravity-ide/scratch/research_system/test/logger.test.js) によりマスキング安全性を検証。
- **UIからの簡単ログ確認 & クリップボードコピー機能**:
  - 画面右上の「⚙️ 設定」モーダル内に「📋 システム診断 & エラーログ」セクションを追加。
  - 直近のエラーログをブラウザ上で直接閲覧でき、「ログをコピー」ボタンでワンクリックで開発者や共有相手に共有可能に。
  - サーバーに `/api/logs` エンドポイントを新設し、最新ログを JSON 形式で安全に取得可能に。

### 🛡️ 他端末での起動トラブルシューティング & 堅牢化 (Cross-Device Startup Hardening)
- **`start.bat` / `start.sh` での依存関係（`node_modules`）自動インストール**:
  - 他の人が GitHub からリポジトリをダウンロード（ZIP解凍）した直後は `node_modules` が存在せず、`Cannot find module 'express'` で即座にクラッシュしていた最大の原因を解消。
  - 初回起動時に `node_modules` が存在しない場合は自動で `npm install` をバックグラウンド実行してから起動するよう制御を改善。
- **Node.js バージョンの事前検査**:
  - Node.js がインストールされていない場合、および Node.js のバージョンが 18 未満の古い環境の場合に、エラーメッセージを分かりやすく表示して停止するバリデーションを追加。
- **ポート競合（3939）時の自動フォールバック起動**:
  - ポート 3939 が他のアプリで使用されていた場合でも即死せず、3940, 3941… と空いているポートを自動探索して起動を継続するポートフォールバックを実装。
- **エラー時のコンソール即死防止**:
  - バッチファイル起動時に万が一エラーが発生しても、コマンドプロンプトが一瞬で消えてしまわないよう `pause`（キー入力待機）し、`data/logs/error.log` の確認を促すメッセージを表示。
- **README へのトラブルシューティング & ログ確認手順の追記**:
  - 他端末で起動しない 5 つの典型パターン（ZIP未解凍、Node.js未導入/古い、初回依存関係未取得、ポート競合、誤検知）とその解決策を網羅。

---

## [v1.1.1] - 2026-10-20

### 🐛 バグ修正 (Bug Fixes)
- **Windows環境で `start.bat` をダブルクリックしても起動しない不具合の解消**:
  - `start.bat` の改行コードが LF になっていたこと、および `if ( ... )` カッコ構文内の UTF-8 日本語が Windows 標準の `cmd.exe` のパーサーと衝突し、起動直後に構文エラーで一瞬で終了（クラッシュ）していた問題を修正。
  - Windows 標準の安全な `goto` 制御構文および CRLF 改行に統一し、どんな Windows 環境でも確実に `node server/start.js` が起動するように改善。

### 🎨 UI/UX 改善 (UI/UX Improvements)
- **シルキーで自然なライト/ダークテーマ切り替えアニメーションの実装**:
  - これまで一部要素のみトランジションがかかり、背景と文字・カードの色変化のタイミングがズレてチカチカしていた問題を解消。
  - モダンブラウザ（Edge / Chrome等）の最先端 GPU レンダリング機能である **`View Transitions API`** を導入し、画面全体が滑らかに溶け合うような映画的クロスフェードを実現。
  - 非対応環境向けにも全画面一括のスムーズトランジション（`theme-transitioning`）をフォールバック実装。
  - テーマ切替ボタン（`#btn-theme`）に、太陽（ゴールド）と月（ネイビー）がスムーズにスプリング回転しながら入れ替わるアイコンアニメーションを追加。
  - 切り替えのたびに画面左下を覆っていた不要なトースト通知を廃止し、操作の快適性を向上。


## [v1.1.0] - 2026-10-20

### 🏗️ アーキテクチャ刷新 (Architectural Modernization)
- **フロントエンドの「God File（神ファイル）」完全解体・ES Modules 化**:
  - これまで 2,566 行に及んでいた巨大モノリス [public/js/app.js](file:///c:/Users/ojkne/.gemini/antigravity-ide/scratch/research_system/public/js/app.js) を、わずか **44 行** のクリーンなエントリーポイントにスリム化。
  - Webpack や Vite などの外部ビルドツールに一切依存せず、モダンブラウザ標準の `<script type="module">` を活用してゼロ依存のまま責務別に 8 つの専門モジュールへ分割：
    1. `public/js/modules/state.js` (47行): グローバルステートとタイマー/接続ライフサイクルの安全管理
    2. `public/js/modules/theme.js` (75行): テーマ切替（ダーク/ライト）と接続ステータス表示
    3. `public/js/modules/research.js` (588行): フォーム入力、リサーチ実行ライフサイクル、リアルタイムSSE購読、エラー診断カード
    4. `public/js/modules/deep-dive.js` (419行): 右ペインのスプリットビュー深掘り対話、テキスト選択引用ツールチップ
    5. `public/js/modules/history.js` (337行): 履歴ドロワー、ホームカード一覧、無制限遡り、削除
    6. `public/js/modules/modals.js` (497行): API設定、スマホ連携QR、A/B比較、プロンプトテンプレート
    7. `public/js/modules/usage-modal.js` (458行): トークン消費モニタリング、残量メーター、日次クォータ計算
    8. `public/js/modules/export-handlers.js` (193行): Markdown, Excel, PDF, 即戦力文面コピー
- **保守性と堅牢性の劇的向上**:
  - 各モジュールの責務が明確になり、「設定画面の修正が原因でチャットが壊れる」といった結合リスクを完全に排除。
  - `public/package.json`（`"type": "module"`）を配置し、エディタ環境およびNode.js環境での構文チェックと型安全性を確立。


## [v1.0.2] - 2026-10-20

### 🧪 テスト & 堅牢化 (Testing & Hardening)
- **Node.js 組み込みテスト（`node:test`）の導入**:
  - 外部テストフレームワーク（Jest等）を追加することなく、ゼロ依存のまま Node.js 18+ 標準のテストランナーを採用。
  - `npm test` コマンドでいつでも全単体テストを即座に実行可能に。
  - APIキーのマスク・安全な公開ビュー（`test/settings.test.js`）、日次クォータ計算と利用状況の集計（`test/usage.test.js`）、検索クエリ・HTMLエンティティ・DuckDuckGoリダイレクトURL解決（`test/search.test.js`）を網羅する 9 件の自動テストを実装。
- **静的型チェック（`// @ts-check`）の導入**:
  - `server/settings.js`, `server/search.js`, `server/usage.js` に型チェック宣言を追加し、関数の未インポートや型不整合を実行前・コーディング中に検知可能に改善。
- **エクスポートとインターフェースの整理**:
  - テストおよびモジュール間連携のため、`unwrapDdgUrl`, `stripTags`, `decodeEntities`, `getNextQuotaReset` などのコアユーティリティを明示的にエクスポート。


## [v1.0.1] - 2026-10-20

### 🐛 バグ修正 (Bug Fixes)
- **スタンドアロン版（.exe）の起動時クラッシュ解消**:
  - Node 18 環境で未定義だった `AbortSignal.any` の互換ポリフィルを実装し、他PCやスタンドアロン実行時にリサーチ開始直後に発生していた `TypeError: AbortSignal.any is not a function` を完全に解決。
- **利用状況画面（/api/usage）の 500 エラー修正**:
  - `server/index.js` で `getFullUsageSummary` のインポート抜けを修正。
  - `server/usage.js` のデータ保存先をスタンドアロン実行時でも安全な `settings.DATA_DIR` に統一。
  - APIキーが1つだけ（Geminiのみ、またはTavilyのみ）登録されている場合でもエラーにならず、設定済みAPIの残量と未設定APIの状態（DuckDuckGo代替中など）を美しく表示するように改善。
- **リサーチ中断・エラー時の動作安定化**:
  - サーバー側がエラー等で切断された際、ブラウザの `EventSource` が勝手に無限自動再接続を繰り返して画面が点滅・多重発火するバグを解消（エラー/終了イベント受信時に即時 `close()` を徹底）。
  - リサーチジョブの終了処理（成功/エラー/中止）に多重実行防止ガード（`isFinishing`）を導入し、タイマーや入力ロック解除が確実に1度で完了するように安定化。

### ⚡ 改善 (Improvements)
- **DuckDuckGo 検索のレートリミット対策**:
  - 通信方式をブロックされにくい GET 方式に刷新。
  - ディープ推論時に複数クエリを一斉に叩いて一時アクセス制限（202 Anomaly）を受けないよう、2本ずつのバッチ＋待機インターバル制御を導入。
  - 万が一 DuckDuckGo が一時制限された場合でも、処理が中断せず Gemini の知識ベースで最後までレポートを完走させる安全フォールバックを実装。
- **起動バッチ（start.bat / start.sh）の親切化**:
  - Node.js がインストールされていない環境で実行された場合、英語ではなく日本語で「Node.js が見つかりません」と明確に表示し、ワンクリック版（`ResearchStudio.exe`）の案内と公式サイトのリンクをわかりやすく提示。
- **エラー画面の診断機能強化**:
  - リサーチエラー時に単なる英字メッセージではなく、【原因】と【💡 解決方法】（サーバー切断、DuckDuckGo制限、APIキー無効など）を視覚的なアドバイスカードとして表示。
  - 「🔄 再試行する」ボタンを押した際、前回の調査パラメータを維持したまま、古い接続残骸を安全に破棄して即座に再実行できるように改善。

### 📚 ドキュメント (Documentation)
- `README.md` に「選べる2つの導入方法（パターン1: ワンクリック版 / パターン2: Node.js版）」を明記。
- Windows Defender SmartScreen（青い警告画面）が表示される理由（実績・高額証明書による機械判定）と、その解除手順（「詳細情報」→「実行」）および安全性の根拠を FAQ として詳細に記載。
- データの引き継ぎ方法を含めた「アプリのアップデート（更新）手順」を追記。

---

## [v1.0.0] - 2026-10-19

### 🎉 初回正式リリース (Initial Release)
- **AIディープリサーチ機能**: テーマを入力するだけでWeb検索・構造化分析・要約・比較表を自動生成。
- **Side-by-Side スプリットビュー**: レポートを閲覧しながら右側パネルで引用深掘り対話が可能。
- **商用A4ベクターPDF出力**: Windows内蔵Edge/Chromeのヘッドレス機能を活用し、追加インストール不要で商用クオリティのPDFを直接ダウンロード。
- **多彩なエクスポート**: Excel (.xlsx), Markdown (.md), Claude/GPTプロンプト生成。
- **二刀流配布モデル**: Node.js開発環境向けのソースコード配布に加え、`pkg` を用いたインストール不要の単一実行ファイル（`ResearchStudio.exe` / zip）をサポート。
- **完全ローカル保管**: APIキーおよびリサーチ履歴を手元PC（`data/`）のみに安全保存。
