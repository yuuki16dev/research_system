@echo off
setlocal
cd /d "%~dp0"

rem 1. Node.js のインストール確認
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto NO_NODE

rem 2. Node.js のバージョン確認 (18以上が必要)
node -e "if (parseInt(process.versions.node) < 18) process.exit(1)" 2>nul
if %ERRORLEVEL% NEQ 0 goto OLD_NODE

rem 3. 初回起動時: node_modules が無ければ自動インストール
if not exist node_modules (
    echo ======================================================================
    echo   [初回セットアップ] 必要なライブラリを自動インストールしています...
    echo   (初回のみ15〜30秒ほど時間がかかります。しばらくお待ちください)
    echo ======================================================================
    call npm install
    if %ERRORLEVEL% NEQ 0 goto NPM_FAIL
    echo   インストールが完了しました。サーバーを起動します...
    echo.
)

rem 4. サーバーマネージャー起動
node server/start.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ======================================================================
    echo   【エラー】Research Studio の起動中に問題が発生しました。
    echo   詳細なエラーログは以下に記録されています:
    echo     data\logs\error.log
    echo ======================================================================
    pause
)
goto :eof

:NO_NODE
cls
echo ======================================================================
echo   【エラー】お使いの PC に Node.js が見つかりませんでした。
echo ======================================================================
echo.
echo   次のいずれかの方法でご利用いただけます：
echo.
echo   【方法 1】Node.js をインストールせずに使う場合（最も簡単・推奨）
echo     GitHub Releases ページからワンクリック版「ResearchStudio.exe」
echo     をダウンロードしてください。Node.js 不要ですぐに使えます。
echo     https://github.com/yuuki16dev/research_system/releases
echo.
echo   【方法 2】Node.js をインストールして使う場合
echo     公式サイトから Node.js (LTS版 / v18以上) をインストールしてください。
echo     https://nodejs.org/
echo.
echo ======================================================================
pause
goto :eof

:OLD_NODE
cls
echo ======================================================================
echo   【エラー】お使いの Node.js のバージョンが古すぎます。
echo   Research Studio の実行には Node.js v18 以上が必要です。
echo ======================================================================
echo.
echo   公式サイトから最新の LTS 版（v20 または v22 推奨）をインストールしてください。
echo   https://nodejs.org/
echo.
echo   または、Node.js の更新が不要なワンクリック版「ResearchStudio.exe」をご利用ください:
echo   https://github.com/yuuki16dev/research_system/releases
echo.
echo ======================================================================
pause
goto :eof

:NPM_FAIL
echo.
echo ======================================================================
echo   【エラー】ライブラリの自動インストール（npm install）に失敗しました。
echo   インターネット接続環境を確認するか、以下のログをご確認ください。
echo ======================================================================
pause
goto :eof
