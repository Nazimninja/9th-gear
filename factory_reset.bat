@echo off
title Factory Reset - 9th Gear AI Agent
cd /d "%~dp0"
echo ===================================================
echo       Factory Reset (Clears Session Data)
echo ===================================================
echo.
echo This will delete your saved WhatsApp session.
echo You will need to SCAN the QR code again after this.
echo.
echo Closing any running agents...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1

echo.
echo Deleting session files...
rmdir /s /q .wwebjs_auth
rmdir /s /q .wwebjs_cache

echo.
echo Done! Session cleared.
echo You can now run 'run_agent.bat' to start fresh.
echo.
pause
