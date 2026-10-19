@echo off
cd /d "%~dp0"

node server/stop.js
ping 127.0.0.1 -n 3 >nul
