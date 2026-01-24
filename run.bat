@echo off
title Polymarket Wallet Discovery System
cd /d "%~dp0"

echo ============================================================
echo    POLYMARKET WALLET DISCOVERY SYSTEM
echo ============================================================
echo.
echo This system will:
echo   - Monitor live trades via WebSocket
echo   - Discover new wallets from trades >= $100
echo   - Fetch 30-day trade history for new wallets
echo   - Calculate metrics (PnL, ROI, Win Rate) automatically
echo.

:: Check if venv exists
if not exist "venv\Scripts\python.exe" (
    echo ERROR: Virtual environment not found!
    echo Please run: python -m venv venv
    echo Then: venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

:: Check if .env exists
if not exist ".env" (
    echo ERROR: .env file not found!
    echo Please copy .env.example to .env and configure it.
    pause
    exit /b 1
)

echo Starting live wallet discovery service...
echo Press Ctrl+C to stop.
echo.

:: Set PYTHONPATH to include project root
set PYTHONPATH=%~dp0

:: Run the live service (includes wallet discovery)
venv\Scripts\python.exe -m src.realtime.service

pause
