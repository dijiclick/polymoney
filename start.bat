@echo off
title Polymarket Live Wallet Discovery
cd /d "%~dp0"

echo.
echo ============================================================
echo    POLYMARKET LIVE WALLET DISCOVERY
echo ============================================================
echo.
echo Features:
echo   - Live trade monitoring via WebSocket
echo   - Auto-discover wallets from trades >= $100
echo   - Calculate metrics (PnL, ROI, Win Rate)
echo   - 3-day cooldown before re-analyzing wallets
echo   - Parallel API calls for fast processing
echo.

:: Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found!
    echo.
    echo Run these commands first:
    echo   python -m venv venv
    echo   venv\Scripts\pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

:: Check if .env exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Please create .env with your Supabase credentials.
    echo.
    pause
    exit /b 1
)

echo Starting service...
echo Press Ctrl+C to stop.
echo.
echo ============================================================
echo.

:: Set PYTHONPATH
set PYTHONPATH=%~dp0

:: Run the live service
venv\Scripts\python.exe -m src.realtime.service

pause
