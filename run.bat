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
echo    1. Dashboard + Wallet Analyzer (Polymarket API)
echo    2. Dashboard + Wallet Analyzer (Goldsky API)
echo    3. Wallet Analyzer Only (Polymarket API)
echo    4. Wallet Analyzer Only (Goldsky API)
echo    5. Dashboard Only
echo    6. Exit
echo.
echo ============================================================
echo.
set /p choice="Select option (1-6): "

if "%choice%"=="1" goto start_all_main
if "%choice%"=="2" goto start_all_goldsky
if "%choice%"=="3" goto start_wallet_main
if "%choice%"=="4" goto start_wallet_goldsky
if "%choice%"=="5" goto start_dashboard
if "%choice%"=="6" exit /b 0
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

:start_all_main
call :check_requirements
if errorlevel 1 goto menu

cls
echo.
echo ============================================================
echo    STARTING: Dashboard + Wallet Analyzer (Polymarket API)
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

echo [2/2] Starting Wallet Analyzer (Polymarket API)...
start "Wallet Analyzer (Polymarket)" cmd /k "cd /d %~dp0 && set PYTHONPATH=%~dp0 && set ANALYSIS_MODE=main && venv\Scripts\python.exe -m src.realtime.service"

echo.
echo ============================================================
echo    SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:        http://localhost:3000
echo    Wallet Analyzer:  Polymarket API mode
echo.
echo    Close each window with Ctrl+C to stop
echo.
echo ============================================================
echo.
pause
goto menu

:start_all_goldsky
call :check_requirements
if errorlevel 1 goto menu

cls
echo.
echo ============================================================
echo    STARTING: Dashboard + Wallet Analyzer (Goldsky API)
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

timeout /t 5 /nobreak >nul

echo [2/2] Starting Wallet Analyzer (Goldsky API)...
start "Wallet Analyzer (Goldsky)" cmd /k "cd /d %~dp0 && set PYTHONPATH=%~dp0 && set ANALYSIS_MODE=goldsky && venv\Scripts\python.exe -m src.realtime.service"

echo.
echo ============================================================
echo    SERVICES RUNNING
echo ============================================================
echo.
echo    Dashboard:        http://localhost:3000
echo    Wallet Analyzer:  Goldsky API mode
echo    NOTE: Analyzer delegates to Dashboard API for analysis
echo.
echo    Close each window with Ctrl+C to stop
echo.
echo ============================================================
echo.
pause
goto menu

:start_wallet_main
call :check_requirements
if errorlevel 1 goto menu

cls
echo.
echo ============================================================
echo    WALLET ANALYZER (Polymarket API)
echo ============================================================
echo.
echo    - Discovers wallets from live trades (>=$100)
echo    - Analyzes with Polymarket API (stores in wallets table)
echo    - 5 workers, 1-day re-analysis cooldown
echo.
echo    Press Ctrl+C to stop
echo.
echo ============================================================
echo.

set PYTHONPATH=%~dp0
set ANALYSIS_MODE=main
venv\Scripts\python.exe -m src.realtime.service

pause
goto menu

:start_wallet_goldsky
call :check_requirements
if errorlevel 1 goto menu

cls
echo.
echo ============================================================
echo    WALLET ANALYZER (Goldsky API)
echo ============================================================
echo.
echo    - Discovers wallets from live trades (>=$100)
echo    - Analyzes with Goldsky subgraphs (stores in goldsky_wallets)
echo    - Delegates analysis to Dashboard API
echo    - Requires Dashboard running on http://localhost:3000
echo.
echo    Press Ctrl+C to stop
echo.
echo ============================================================
echo.

set PYTHONPATH=%~dp0
set ANALYSIS_MODE=goldsky
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
