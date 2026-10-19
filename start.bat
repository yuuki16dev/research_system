@echo off
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo ========================================================
    echo   [ERROR] Node.js is not found.
    echo   Please install Node.js from: https://nodejs.org/
    echo ========================================================
    pause
    exit /b 1
)

if not exist node_modules (
    echo [Setup] Installing required packages...
    call npm install
)

echo Starting Research Studio...
start http://localhost:3939
node server/index.js
pause
