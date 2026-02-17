@echo off
title Deep Clean & Reinstall - 9th Gear AI
cd /d "%~dp0"
echo ===================================================
echo       DEEP CLEAN & REINSTALL (Fixes Crashes)
echo ===================================================
echo.
echo 1. Killing running processes...
taskkill /F /IM node.exe >nul 2>&1
taskkill /F /IM chrome.exe >nul 2>&1

echo.
echo 2. Deleting temporary files and session data...
if exist node_modules rmdir /s /q node_modules
if exist .wwebjs_auth rmdir /s /q .wwebjs_auth
if exist .wwebjs_cache rmdir /s /q .wwebjs_cache
if exist package-lock.json del package-lock.json

echo.
echo 3. Re-installing dependencies (This may take a few minutes)...
call npm install

echo.
echo ===================================================
echo       DONE! System is fresh.
echo ===================================================
echo.
echo Please run 'run_agent.bat' now.
echo You will need to scan the QR code again.
echo.
pause
