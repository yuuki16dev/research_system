@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"
title Research Studio Launcher

echo ======================================================================
echo   Research Studio Launcher
echo   アプリ名 : Research Studio
echo ======================================================================
echo.

rem 1. Node.js のインストール確認
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto NO_NODE

rem 2. 依存ライブラリのチェック（未インストールまたは不足パッケージがある場合は自動インストール）
set NEED_INSTALL=0
if not exist node_modules (
    set NEED_INSTALL=1
) else if not exist "node_modules\exceljs" (
    set NEED_INSTALL=1
) else if not exist "node_modules\express" (
    set NEED_INSTALL=1
)

if "%NEED_INSTALL%"=="1" (
    echo ======================================================================
    echo   [ライブラリ確認] 必要なパッケージを自動インストール・更新しています...
    echo   (初回またはアプデ時のみ15〜30秒ほど時間がかかります。お待ちください)
    echo ======================================================================
    call npm install
    if %ERRORLEVEL% NEQ 0 goto NPM_FAIL
    echo   ライブラリの準備が完了しました。サーバーを起動します...
    echo.
)

rem 3. サーバーマネージャー起動（バージョン確認・ポート確認・ブラウザ起動）
node server/start.js
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ======================================================================
    echo   【エラー】Research Studio の起動中に問題が発生しました。
    echo.
    echo   もしこの方法で起動できない場合は、もう1つの方法である
    echo   【Node.js不要のワンクリック版（ResearchStudio.exe）】をお試しください:
    echo     https://github.com/yuuki16dev/research_system/releases
    echo.
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
echo   この起動方法（start.bat）には Node.js (v18以上) が必要です。
echo.
echo   次のいずれかの方法でご利用いただけます：
echo.
echo   【推奨・最も簡単】Node.js を入れずに使う場合（もう1つの方法）
echo     GitHub Releases ページからワンクリック版「ResearchStudio.exe」
echo     をダウンロードしてください。Node.js 不要ですぐに使えます。
echo     https://github.com/yuuki16dev/research_system/releases
echo.
echo   【通常】Node.js をインストールして使う場合
echo     公式サイトから Node.js (LTS版 / v18以上) をインストールしてください。
echo     https://nodejs.org/
echo.
echo ======================================================================
pause
goto :eof

:NPM_FAIL
echo.
echo ======================================================================
echo   【エラー】ライブラリの自動インストール（npm install）に失敗しました。
echo.
echo   インターネット接続環境を確認するか、以下のログをご確認ください:
echo     data\logs\error.log
echo.
echo   もし環境要因で解決が難しい場合は、もう1つの方法である
echo   【Node.js不要のワンクリック版（ResearchStudio.exe）】をお試しください:
echo     https://github.com/yuuki16dev/research_system/releases
echo ======================================================================
pause
goto :eof
