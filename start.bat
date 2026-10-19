@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo ======================================================================
    echo   【エラー】お使いの PC に Node.js が見つかりませんでした。
    echo ======================================================================
    echo.
    echo   次のいずれかの方法でご利用いただけます：
    echo.
    echo   【方法 1】Node.js をインストールせずに使う場合（推奨）
    echo     GitHub の Releases ページからワンクリック版「ResearchStudio.exe」
    echo     をダウンロードしてください。Node.js 不要ですぐに使えます。
    echo     https://github.com/yuuki16dev/research_system/releases
    echo.
    echo   【方法 2】Node.js をインストールして使う場合
    echo     公式サイトから Node.js (LTS版推奨) をインストールしてください。
    echo     https://nodejs.org/
    echo     インストール後、もう一度この start.bat を開いてください。
    echo.
    echo ======================================================================
    echo 何かキーを押すと終了します...
    pause >nul
    exit /b 1
)

if not exist node_modules (
    echo ======================================================================
    echo   [初回セットアップ] 必要なライブラリを自動インストールしています...
    echo ======================================================================
    call npm install
)

node server/start.js
if errorlevel 1 (
    echo.
    echo [エラー] サーバーの起動中に問題が発生しました。
    pause
)

