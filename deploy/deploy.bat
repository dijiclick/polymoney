@echo off
REM Polymarket VPS Deployment Script (Batch version)
REM This is a wrapper for the PowerShell script

setlocal

if "%1"=="" (
    echo.
    echo ============================================================
    echo   Polymarket VPS Deployment
    echo ============================================================
    echo.
    echo Usage: deploy.bat ^<VPS_HOST^> ^<VPS_USER^> [OPTIONS]
    echo.
    echo Required:
    echo   VPS_HOST    - Your VPS hostname or IP address
    echo   VPS_USER    - SSH username for VPS
    echo.
    echo Optional:
    echo   --port PORT         - SSH port (default: 22)
    echo   --ppk PATH          - Path to PPK file (default: .\aws-aria.ppk)
    echo   --app-path PATH     - Remote app path (default: /opt/polymarket)
    echo   --skip-upload       - Skip file upload step
    echo.
    echo Example:
    echo   deploy.bat 192.168.1.100 ubuntu --port 22
    echo.
    exit /b 1
)

REM Check if PowerShell is available
powershell -Command "exit 0" >nul 2>&1
if errorlevel 1 (
    echo ERROR: PowerShell is required but not found
    exit /b 1
)

REM Get script directory
set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."

REM Change to project root
cd /d "%PROJECT_ROOT%"

REM Run PowerShell script
powershell -ExecutionPolicy Bypass -File "%SCRIPT_DIR%deploy.ps1" %*

endlocal
