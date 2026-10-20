@echo off
setlocal
cd /d "%~dp0"
title Research Studio Launcher

echo ======================================================================
echo   ◆ Research Studio  起動ランチャー
echo   アプリ本体 : Research Studio
echo   実行環境   : Node.js (動作要件: v18以上)
echo ======================================================================
echo.

rem 1. Node.js のインストール確認
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto NO_NODE

rem 2. Node.js のバージョン確認 (Node.js 18以上が必要)
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
echo   【環境エラー】お使いの PC に Node.js が見つかりませんでした
echo ======================================================================
echo.
echo   Research Studio の実行には Node.js (v18以上) が必要です。
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
echo   【環境エラー】Node.js のバージョンが要件を満たしていません
echo ======================================================================
echo.
echo   お使いの PC の Node.js バージョンが古いため起動できません。
echo.
echo   ・アプリ本体  : Research Studio
echo   ・必要環境    : Node.js (バージョン 18 以上)
echo   ・検出環境    : 
node -v 2>nul
echo.
echo   ※「v18以上」はアプリのバージョンではなく、実行に必要な Node.js のバージョンです。
echo.
echo   【解決方法 1】Node.js を最新版に更新する
echo     公式サイトから最新の LTS 版（v20 または v22 推奨）をインストールしてください。
echo     https://nodejs.org/
echo.
echo   【解決方法 2】Node.js の更新が不要なワンクリック版を使う
echo     GitHub Releases からワンクリック版「ResearchStudio.exe」をご利用ください:
echo     https://github.com/yuuki16dev/research_system/releases
echo.
echo ======================================================================
pause
goto :eof

:NPM_FAIL
echo.
echo ======================================================================
echo   【エラー】ライブラリの自動インストール（npm install）に失敗しました。
echo   インターネット接続環境を確認するか、以下のログをご確認ください。
echo   data\logs\error.log
echo ======================================================================
pause
goto :eof
