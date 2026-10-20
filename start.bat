@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 goto NO_NODE

node server/start.js
if %ERRORLEVEL% NEQ 0 pause
goto :eof

:NO_NODE
cls
echo ======================================================================
echo   [ERROR] Node.js is not installed / Node.js が見つかりませんでした。
echo ======================================================================
echo.
echo   [Option 1] Use standalone ResearchStudio.exe (No Node.js needed)
echo   GitHub Releases からインストール不要版 ResearchStudio.exe をご利用ください。
echo   https://github.com/yuuki16dev/research_system/releases
echo.
echo   [Option 2] Install Node.js LTS from official site
echo   公式サイトから Node.js (LTS版) をインストールしてください。
echo   https://nodejs.org/
echo.
echo ======================================================================
pause
goto :eof
