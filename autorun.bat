@echo off
title Polymarket Analytics - System Launcher
cd /d "%~dp0"

echo.
echo ============================================================
echo    POLYMARKET TRADER ANALYTICS SYSTEM
echo ============================================================
echo.

:: ============================================================
:: CONFIGURATION
:: ============================================================
set DASHBOARD_PORT=3000
set REFRESH_METRICS_ON_START=0
set REFRESH_LIMIT=50

:: ============================================================
:: PRE-FLIGHT CHECKS
:: ============================================================
echo [CHECK] Verifying system requirements...
echo.

:: Check Python venv
if not exist "venv\Scripts\python.exe" (
    echo [ERROR] Python virtual environment not found!
    echo.
    echo Run these commands first:
    echo   python -m venv venv
    echo   venv\Scripts\pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)
echo [OK] Python venv found

:: Check .env file
if not exist ".env" (
    echo [ERROR] .env file not found!
    echo Please create .env with your Supabase credentials.
    echo.
    pause
    exit /b 1
)
echo [OK] .env file found

:: Check dashboard dependencies
if not exist "dashboard\node_modules" (
    echo [WARN] Dashboard dependencies not installed. Installing...
    cd dashboard
    call npm install
    cd ..
)
echo [OK] Dashboard dependencies ready

:: Check dashboard .env.local
if not exist "dashboard\.env.local" (
    echo [WARN] dashboard\.env.local not found, creating from .env...
    copy .env dashboard\.env.local >nul 2>&1
)
echo [OK] Dashboard env configured

echo.
echo ============================================================
echo.

:: ============================================================
:: START SERVICES
:: ============================================================

:: Set Python path
set PYTHONPATH=%~dp0

echo [1/2] Starting Next.js Dashboard...
start "Dashboard - localhost:%DASHBOARD_PORT%" cmd /k "cd /d %~dp0dashboard && npm run dev"

:: Wait for dashboard to initialize
timeout /t 3 /nobreak >nul

echo [2/2] Starting Python Backend (Live Trade Monitor)...
start "Backend - Trade Monitor" cmd /k "cd /d %~dp0 && venv\Scripts\python.exe -m src.realtime.service"

:: Wait for backend to initialize
timeout /t 2 /nobreak >nul

echo.
echo ============================================================
echo    ALL SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:      http://localhost:%DASHBOARD_PORT%
echo    - Wallets:      http://localhost:%DASHBOARD_PORT%/wallets
echo    - Live Feed:    http://localhost:%DASHBOARD_PORT%/live
echo    - Watchlist:    http://localhost:%DASHBOARD_PORT%/watchlist
echo.
echo ============================================================
echo    ADMIN COMMANDS (run in new terminal):
echo ============================================================
echo.
echo    Refresh top 50 wallets:
echo    curl -X POST "http://localhost:%DASHBOARD_PORT%/api/admin/refresh-metrics?limit=50"
echo.
echo    Refresh all wallets:
echo    curl -X POST "http://localhost:%DASHBOARD_PORT%/api/admin/refresh-metrics?all=true"
echo.
echo    Refresh specific wallet:
echo    curl -X POST "http://localhost:%DASHBOARD_PORT%/api/admin/refresh-metrics?address=0x..."
echo.
echo ============================================================
echo.
echo Press any key to close this launcher (services keep running)
echo Close each service window with Ctrl+C to stop them
echo.
pause >nul
