@echo off
title Push to GitHub (Auto-Commit)
echo ===================================================
echo       SYNCING WITH GITHUB...
echo ===================================================

echo.
echo 1. Adding all changes...
git add .

echo.
echo 2. Committing changes...
git commit -m "chore: Cloud-Ready Update (Sheets JSON + Human Delays)"

echo.
echo 3. Pushing to GitHub...
git push origin main

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Push failed. 
    echo If this is your first time, you might need to set the remote URL.
    echo.
    set /p repo_url="Enter Repo URL (if needed): "
    if not "%repo_url%"=="" (
        git remote add origin %repo_url%
        git push -u origin main
    )
)

echo.
echo ===================================================
echo       DONE!
echo ===================================================
pause
