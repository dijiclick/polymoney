@echo off
title Polymarket Analytics
cd /d "%~dp0"

:menu
cls
echo.
echo ============================================================
echo    POLYMARKET ANALYTICS SYSTEM
echo ============================================================
echo.
echo    1. Main + Dashboard    (Python discovery + Dashboard)
echo    2. New + Dashboard     (Node.js trade sync + Dashboard)
echo    3. Dashboard Only
echo    4. Run All             (Python + Node.js + Dashboard)
echo.
echo    5. Exit
echo.
echo ============================================================
echo.
set /p choice="Select option (1-5): "

if "%choice%"=="1" goto start_main_dashboard
if "%choice%"=="2" goto start_new_dashboard
if "%choice%"=="3" goto start_dashboard
if "%choice%"=="4" goto start_all
if "%choice%"=="5" exit /b 0
goto menu

:check_python
if not exist "venv\Scripts\python.exe" (
    echo.
    echo [ERROR] Python virtual environment not found!
    echo.
    echo Run these commands first:
    echo   python -m venv venv
    echo   venv\Scripts\pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)
if not exist ".env" (
    echo.
    echo [ERROR] .env file not found!
    echo Please create .env with your Supabase credentials.
    echo.
    pause
    exit /b 1
)
exit /b 0

:check_node
if not exist "new\.env" (
    echo.
    echo [ERROR] new\.env file not found!
    echo Please create new\.env with your Supabase credentials.
    echo.
    pause
    exit /b 1
)
if not exist "new\node_modules" (
    echo [INFO] Installing trade sync dependencies...
    cd new
    call npm install
    cd ..
)
exit /b 0

:check_dashboard
if not exist "dashboard\node_modules" (
    echo [INFO] Installing dashboard dependencies...
    cd dashboard
    call npm install
    cd ..
)
exit /b 0

:: ============================================================
::  Option 1: Main + Dashboard
:: ============================================================
:start_main_dashboard
call :check_python
if errorlevel 1 goto menu
call :check_dashboard

cls
echo.
echo ============================================================
echo    STARTING: Main + Dashboard
echo ============================================================
echo.

set PYTHONPATH=%~dp0

echo [1/2] Starting Dashboard...
start "Polymarket Dashboard" cmd /k "cd /d %~dp0dashboard && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Wallet Discovery...
start "Wallet Discovery" cmd /k "cd /d %~dp0 && set PYTHONPATH=%~dp0 && venv\Scripts\python.exe -m src.realtime.service"

echo.
echo ============================================================
echo    SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:          http://localhost:3000/wallets
echo    Wallet Discovery:   Watching live trades ^>= $100
echo.
echo    Close each window with Ctrl+C to stop
echo.
echo ============================================================
echo.
pause
goto menu

:: ============================================================
::  Option 2: New + Dashboard
:: ============================================================
:start_new_dashboard
call :check_node
if errorlevel 1 goto menu
call :check_dashboard

cls
echo.
echo ============================================================
echo    STARTING: New + Dashboard
echo ============================================================
echo.

echo [1/2] Starting Dashboard...
start "Polymarket Dashboard" cmd /k "cd /d %~dp0dashboard && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Live Trade Sync...
start "Live Trade Sync" cmd /k "cd /d %~dp0new && node scripts/live-sync.js"

echo.
echo ============================================================
echo    SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:          http://localhost:3000/new
echo    Live Trade Sync:    Watching for trades ^>= $100
echo.
echo    Close each window with Ctrl+C to stop
echo.
echo ============================================================
echo.
pause
goto menu

:: ============================================================
::  Option 3: Dashboard Only
:: ============================================================
:start_dashboard
call :check_dashboard

cls
echo.
echo ============================================================
echo    POLYMARKET DASHBOARD
echo ============================================================
echo.
echo    Starting Next.js dashboard on http://localhost:3000
echo    Press Ctrl+C to stop
echo.
echo ============================================================
echo.

cd dashboard
call npm run dev

pause
goto menu

:: ============================================================
::  Option 4: Run All
:: ============================================================
:start_all
call :check_python
if errorlevel 1 goto menu
call :check_node
if errorlevel 1 goto menu
call :check_dashboard

cls
echo.
echo ============================================================
echo    STARTING: All Services
echo ============================================================
echo.

set PYTHONPATH=%~dp0

echo [1/3] Starting Dashboard...
start "Polymarket Dashboard" cmd /k "cd /d %~dp0dashboard && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/3] Starting Wallet Discovery (Python)...
start "Wallet Discovery" cmd /k "cd /d %~dp0 && set PYTHONPATH=%~dp0 && venv\Scripts\python.exe -m src.realtime.service"

timeout /t 2 /nobreak >nul

echo [3/3] Starting Live Trade Sync (Node.js)...
start "Live Trade Sync" cmd /k "cd /d %~dp0new && node scripts/live-sync.js"

echo.
echo ============================================================
echo    ALL SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:          http://localhost:3000
echo    Main (wallets):     http://localhost:3000/wallets
echo    New (trades):       http://localhost:3000/new
echo    Wallet Discovery:   Python - watching live trades ^>= $100
echo    Trade Sync:         Node.js - syncing trade history
echo.
echo    Close each window with Ctrl+C to stop
echo.
echo ============================================================
echo.
pause
goto menu
