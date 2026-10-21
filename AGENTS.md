# Project Operational Guidelines & Behavioral Rules

## 1. バージョン管理・リリース意識の徹底 (Versioning Awareness)
- 本プロジェクトは [Semantic Versioning 2.0.0](https://semver.org/lang/ja/) に準拠します。
- **機能追加・大幅改修のたびに、AI は常に現在のバージョンを意識し、適切なタイミングで能動的にバージョンアップ（MINOR / PATCH）の提案を行うこと。**
  - 新機能追加時: `MINOR` アップデート（例: `v1.1.5` → `v1.2.0`）を提案
  - バグ修正時: `PATCH` アップデート（例: `v1.1.5` → `v1.1.6`）を提案
- バージョン変更時は、`package.json`, `package-lock.json`, `CHANGELOG.md`, `public/index.html`, `server/*.js` の全同期を行い、`npm test` で整合性を保証すること。
- **他システム・他フォルダでの新規開発着手時における推奨プロトコル**:
  - 別のフォルダや新規リポジトリで初めての開発に着手する際は、初動で必ず「**本プロジェクトでも Semantic Versioning によるバージョン管理を行いますか？**」と提案し、管理の導入を促すこと。
- 詳細なルールは `.agents/rules/versioning.md` を参照すること。

## 2. 実装・検証プロトコル
- コード変更後は必ず `npm test`（単体・結合・整合性テスト全件）を実行し、100% 合格を確認すること。
- ユーザー指示にない不要な機能実装は行わず、仕様決定を要するものは対話を通じて選択肢を提示すること。
