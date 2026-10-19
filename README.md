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

## 🚀 選べる2つの導入方法（利用環境に合わせて選べます）

お使いのPC環境に合わせて、**「Node.js不要のワンクリック版」**または**「Node.js環境向けソースコード版」**のいずれかをお選びいただけます。

---

### パターン 1：Node.js が入っていない場合（一般ユーザー向け・推奨 ⭐）

Node.js やコマンドの知識は一切不要です。ダウンロードしてダブルクリックするだけで即座に使えます。

1. **GitHub Releases からダウンロード**:
   - [**GitHub Releases（最新版ダウンロード）**](https://github.com/yuuki16dev/research_system/releases) にアクセスします。
   - `ResearchStudio-win.zip`（または `ResearchStudio.exe`）をクリックしてダウンロードします。
2. **ダブルクリックで起動**:
   - ダウンロードした zip を右クリックして「すべて展開」し、フォルダ内の **`ResearchStudio.exe`** をダブルクリックします。
   - 自動的にブラウザが立ち上がり、**`http://localhost:3939`** にアクセスされます。
   - （※ 設定や履歴は `.exe` と同じ場所に自動作成される `data/` フォルダに安全に保存されます）

> 💡 **初回起動時に「Windows によって PC が保護されました」と表示される場合**:
> 個人開発・オープンソースのため高額な企業署名を省略しており、Windows SmartScreen の警告画面（青い画面）が表示される場合があります。
> **「詳細情報」** をクリック ➔ **「実行」** ボタンを押すことで問題なく起動できます。（※ 初回のみ。ウィルス等の有害なコードは一切含まれておりません）
> もし社内規定等で警告解除が難しい場合は、後述の **パターン 2（Node.js版 / `start.bat`）** をご利用ください（警告なく起動します）。

---

### パターン 2：Node.js が入っている場合（開発者・ソースから動かしたい方向け）

リポジトリをダウンロード（またはクローン）して、最新のソースコードから起動します。

1. **ダウンロード または クローン**:
   - **GitHubからZIPで保存する場合**: 画面上部の緑色の「Code」ボタン → **「Download ZIP」** をクリックして解凍。
   - **Git でクローンする場合**:
     ```bash
     git clone https://github.com/yuuki16dev/research_system.git
     cd research_system
     ```
2. **起動する（ワンクリック対応）**:
   - **🪟 Windows**: フォルダ内の **`start.bat`** をダブルクリックするだけ！（依存関係の確認・ブラウザ自動オープンまで全自動で行われます）
   - **🍎 Mac / 🐧 Linux**:
     ```bash
     chmod +x start.sh stop.sh
     ./start.sh
     ```
   - **npm コマンドで起動**:
     ```bash
     npm install
     npm start
     ```
3. ブラウザで **`http://localhost:3939`** が開きます。

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

- **Windows**: フォルダ内の **`stop.bat`** をダブルクリック（または黒い画面で `Ctrl + C`）
- **Mac / Linux**: `./stop.sh` を実行
- **npm コマンド**: `npm run stop`

---

## 🔄 アプリのアップデート（更新）手順

機能追加やバグ修正の新しいバージョンがリリースされた場合、**これまでの調査履歴やAPIキー設定を引き継いだまま**以下の手順で簡単に更新できます。

### パターン 1：ワンクリック版（.exe）の更新
1. [GitHub Releases](https://github.com/yuuki16dev/research_system/releases) から最新の `ResearchStudio-win.zip` をダウンロードします。
2. 解凍して出てきた新しい **`ResearchStudio.exe`** を、お使いのフォルダに**上書き保存（置き換え）**します。
3. （※ フォルダ内の `data/` フォルダはそのまま残るため、設定や履歴データはすべて引き継がれます）
4. あとは `ResearchStudio.exe` を起動すればアップデート完了です。

### パターン 2：Node.js版（ソースコード）の更新
- **Git をお使いの場合**:
  ```bash
  git pull
  npm install
  npm start
  ```
- **ZIP でダウンロードしてお使いの場合**:
  新しい ZIP を展開後、古いフォルダの **`data/` フォルダ**（および `.env`）を新しいフォルダへそのままコピーしてください。

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

## 🛠️ スタンドアロン実行ファイル（.exe）のビルド

Node.js不要のワンクリック配布用実行ファイル（`dist/ResearchStudio.exe`）を自分でビルドしたい場合は、以下のコマンドを実行します：

```bash
npm run build:exe
```
`dist/` フォルダ配下に Windows 用の `ResearchStudio.exe`（約50MB）が生成されます。これを zip 圧縮して GitHub Releases にアップロードすることで、誰でもワンクリックで使えるアプリとして配布できます。

---

## 📄 ライセンス
MIT License
