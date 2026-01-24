@echo off
title Polymarket Goldsky Collector
cd /d "%~dp0"

echo ============================================================
echo    GOLDSKY WALLET COLLECTOR
echo ============================================================
echo.
echo This script extracts wallet addresses from blockchain data.
echo Scans the last 30 days of Polymarket transactions.
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

:: Set PYTHONPATH to include project root
set PYTHONPATH=%~dp0

:: Run the Goldsky collector
venv\Scripts\python.exe scripts\run_goldsky.py

pause
