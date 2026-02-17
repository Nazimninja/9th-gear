@echo off
title 9th Gear WhatsApp AI Agent
cd /d "%~dp0"
echo ===================================================
echo       Starting 9th Gear WhatsApp AI Agent
echo ===================================================
echo.
echo Cleaning up previous sessions...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1
echo.
echo 1. Fetching latest vehicle data...
echo 2. generating QR Code...
echo.
echo Please wait for the QR code to appear below.
echo Scan it with your WhatsApp Business App (Linked Devices).
echo.

node index.js

echo.
echo Agent stopped.
pause
