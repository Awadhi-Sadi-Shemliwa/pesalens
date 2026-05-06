@echo off
echo ========================================
echo Airtel Money Analysis - GitHub Push
echo ========================================
echo.

echo Step 1: Checking Git installation...
git --version
if %errorlevel% neq 0 (
    echo ERROR: Git is not installed!
    echo Please install Git from: https://git-scm.com/download/win
    pause
    exit /b 1
)

echo.
echo Step 2: Initializing Git repository...
git init

echo.
echo Step 3: Adding files...
git add .

echo.
echo Step 4: Creating commit...
git commit -m "Add Airtel Money transaction analysis project"

echo.
echo Step 5: Connecting to GitHub...
git remote add origin https://github.com/Awadhi-Sadi-Shemliwa/awadh.git 2>nul
if %errorlevel% neq 0 (
    echo Remote already exists, updating...
    git remote set-url origin https://github.com/Awadhi-Sadi-Shemliwa/awadh.git
)

echo.
echo Step 6: Pushing to GitHub...
echo NOTE: You may be prompted for GitHub credentials
git branch -M main
git push -u origin main

echo.
echo ========================================
echo Done! Check your GitHub repository:
echo https://github.com/Awadhi-Sadi-Shemliwa/awadh
echo ========================================
pause


