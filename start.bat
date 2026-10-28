@echo off
chcp 65001 >nul
title Ninja Night - LAN Server
cd /d "%~dp0"
echo Starting Ninja Night server...
echo.
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
