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
echo    1. Start All (Dashboard + Wallet Analyzer)
echo    2. Start Wallet Analyzer Only
echo    3. Start Dashboard Only
echo    4. Exit
echo.
echo ============================================================
echo.
set /p choice="Select option (1-4): "

if "%choice%"=="1" goto start_all
if "%choice%"=="2" goto start_wallet
if "%choice%"=="3" goto start_dashboard
if "%choice%"=="4" exit /b 0
goto menu

:check_requirements
:: Check Python venv
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

:: Check .env file
if not exist ".env" (
    echo.
    echo [ERROR] .env file not found!
    echo Please create .env with your Supabase credentials.
    echo.
    pause
    exit /b 1
)
exit /b 0

:start_all
call :check_requirements
if errorlevel 1 goto menu

cls
echo.
echo ============================================================
echo    STARTING ALL SERVICES
echo ============================================================
echo.

set PYTHONPATH=%~dp0

:: Check dashboard dependencies
if not exist "dashboard\node_modules" (
    echo [INFO] Installing dashboard dependencies...
    cd dashboard
    call npm install
    cd ..
)

echo [1/2] Starting Dashboard...
start "Polymarket Dashboard" cmd /k "cd /d %~dp0dashboard && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Wallet Analyzer...
start "Polymarket Wallet Analyzer" cmd /k "cd /d %~dp0 && set PYTHONPATH=%~dp0 && venv\Scripts\python.exe -m src.realtime.service"

echo.
echo ============================================================
echo    SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:        http://localhost:3000
echo    Wallet Analyzer:  Running in background
echo.
echo    Close each window with Ctrl+C to stop
echo.
echo ============================================================
echo.
pause
goto menu

:start_wallet
call :check_requirements
if errorlevel 1 goto menu

cls
echo.
echo ============================================================
echo    POLYMARKET WALLET ANALYZER
echo ============================================================
echo.
echo    - Discovers wallets from live trades (>=$50)
echo    - Calculates metrics (PnL, ROI, Win Rate, Drawdown)
echo    - 5 workers, 1-day re-analysis cooldown
echo    - Stores to Supabase database
echo.
echo    Press Ctrl+C to stop
echo.
echo ============================================================
echo.

set PYTHONPATH=%~dp0
venv\Scripts\python.exe -m src.realtime.service

pause
goto menu

:start_dashboard
:: Check dashboard dependencies
if not exist "dashboard\node_modules" (
    echo [INFO] Installing dashboard dependencies...
    cd dashboard
    call npm install
    cd ..
)

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
