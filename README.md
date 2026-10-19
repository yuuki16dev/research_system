# Research Studio — AIリサーチ＆商用レポート自動化システム

> **テーマを入れるだけで、Web検索・専門サイト巡回・AI分析を行い、エグゼクティブ要約・比較表・商用A4 PDFまで自動生成する次世代リサーチダッシュボード**

![Research Studio Banner](public/favicon.svg)

---

## ✨ 主な機能と特徴

- **⚡ ワンクリック・高速ディープリサーチ**:
  - 知りたいテーマを入力するだけで、Gemini が論点を自動分解し、Web全体や特定サイト（Zenn, Qiita, 専門メディア等）を横断巡回・ファクトチェック・構造化分析します。
- **💬 Side-by-Side スプリットビュー深掘り対話**:
  - レポート本文や比較表をスクロール閲覧しながら、右側パネルでAIアシスタントと追加対話検索が可能。
  - レポート内の文章をマウスでドラッグ選択するだけで「✨ 引用して深掘り質問」ができます。回答をレポート末尾に即座に追記することも可能。
- **📄 ワンクリック商用A4 PDF直接ダウンロード**:
  - PC内蔵の Edge / Chrome ヘッドレス機能を活用し、印刷ダイアログを挟まずに、表紙・目次・比較表が1ミリも狂わない本物の商用A4ベクターPDFを直接ダウンロードフォルダに保存します。
- **📊 多彩なビジネス出力フォーマット**:
  - **商用PDF** / **Excel (.xlsx)** / **Markdown (.md)** / **Claude連携プロンプト** / **Slack・Teams用要約** / **スライド骨子**
- **⚖️ レポート比較（A/B分析）**:
  - 過去に実行した2つのリサーチ結果をワイドな横並び画面で突合し、エグゼクティブサマリー、重要指標、示唆の差分を瞬時に把握できます。
- **🔒 安全なローカル動作・プライバシー保護**:
  - 調査履歴やAPIキーはすべて手元のPC内（`data/`）にのみ安全に保管されます。外部サーバーへの情報送信はありません。

---

## 🚀 クイックスタート（誰でも3ステップで起動）

### 前提条件
- **[Node.js](https://nodejs.org/)** (v18.0.0 以上推奨)

---

### 1. リポジトリをクローン
```bash
git clone https://github.com/<your-username>/research_system.git
cd research_system
```

### 2. 起動する（ワンクリック対応）

#### 🪟 Windows の場合
フォルダ内の **`start.bat`** をダブルクリックするだけ！  
（初回のみ必要なパッケージのインストールが自動実行され、ブラウザが自動で立ち上がります）

#### 🍎 Mac / 🐧 Linux の場合
```bash
chmod +x start.sh stop.sh
./start.sh
```

#### または npm コマンドで起動
```bash
npm install
npm start
```

ブラウザで **`http://localhost:3939`** が開きます。

---

### 3. APIキーを設定（完全無料）

起動後、画面右上の **「⚙️ 設定」** アイコンをクリックしてAPIキーを入力・保存してください。

| APIサービス | 料金 | 取得先 | 備考 |
| :--- | :--- | :--- | :--- |
| **Google Gemini API** | **完全無料** (クレカ不要) | [Google AI Studio](https://aistudio.google.com/) | **必須**: Gemini 3.8 Flash などの最新モデルが無料で利用可能 |
| **Tavily Search API** | **月1,000回無料** | [Tavily AI](https://app.tavily.com/) | **任意**: 未設定の場合は DuckDuckGo (完全無料・キー不要) が自動使用されます |

> 💡 **ファイルで設定したい場合**:  
> `.env.example` をコピーして `.env` を作成し、キーを記入することでも設定可能です。

---

## 🛑 停止方法

- **Windows**: フォルダ内の **`stop.bat`** をダブルクリック
- **Mac / Linux**: `./stop.sh` を実行
- **npm コマンド**: `npm run stop`

---

## 📁 ディレクトリ構成

```text
├── public/                  # フロントエンド（HTML/CSS/Vanilla JS）
│   ├── index.html           # メインUI（スプリットビュー・モーダル等）
│   ├── css/                 # スタイルシート（styles.css, print.css）
│   ├── js/                  # アプリケーションロジック（app.js, render.js, exporters.js 等）
│   └── vendor/              # 内蔵ライブラリ（html2pdf, SheetJS 等）
├── server/                  # バックエンド（Node.js / Express）
│   ├── index.js             # APIルーティング・サーバー本体
│   ├── pdf.js               # Edge/ChromeヘッドレスPDF生成モジュール
│   ├── pipeline.js          # Geminiリサーチパイプライン
│   ├── deepdive.js          # 引用深掘り対話エンジン
│   ├── search.js            # Tavily / DuckDuckGo 検索モジュール
│   └── settings.js          # 設定管理・マスキング保存
├── .env.example             # 環境変数テンプレート
├── .gitignore               # 機密情報（.env, data/ 等）の除外設定
├── start.bat / stop.bat     # Windows用ワンクリック起動・停止バッチ
├── start.sh / stop.sh       # Mac/Linux用起動・停止シェル
└── package.json             # プロジェクト構成情報
```

---

## 🛡️ セキュリティとチーム共有

- `.gitignore` により、個人のAPIキーや検索履歴が保存される `data/` フォルダ、および `.env` は**Git追跡から完全に除外**されています。
- リポジトリをGitHubのパブリック（公開）にプッシュしても、ご自身のAPIキーやプライベートな調査データが誤って流出することはありません。

---

## 📄 ライセンス
MIT License
