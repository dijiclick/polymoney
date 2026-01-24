@echo off
title Polymarket Live Feed Service
cd /d "%~dp0"

echo ============================================================
echo    POLYMARKET LIVE FEED SERVICE
echo ============================================================
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

echo Starting live feed service...
echo Press Ctrl+C to stop.
echo.

:: Run the service
venv\Scripts\python.exe -m src.realtime.service

pause
