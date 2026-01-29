# Check deployment status
param(
    [Parameter(Mandatory=$true)]
    [string]$VpsHost,
    
    [Parameter(Mandatory=$true)]
    [string]$VpsUser,
    
    [Parameter(Mandatory=$false)]
    [int]$VpsPort = 22,
    
    [Parameter(Mandatory=$false)]
    [string]$PpkPath = ".\aws-aria.ppk"
)

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Deployment Status Check" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

$statusScript = @'
#!/bin/bash
APP_PATH="/opt/polymarket"
completed=0
total=6

echo "Checking deployment progress..."
echo ""

# Step 1: Files uploaded
echo "[1/6] Files Uploaded:"
if [ -d "$APP_PATH/src" ] && [ -d "$APP_PATH/dashboard" ] && [ -f "$APP_PATH/requirements.txt" ]; then
    echo "  [OK] Files present"
    completed=$((completed + 1))
else
    echo "  [ ] Files missing"
fi
echo ""

# Step 2: System dependencies
echo "[2/6] System Dependencies:"
if command -v python3 >/dev/null 2>&1; then
    echo "  [OK] Python3 installed"
    if command -v node >/dev/null 2>&1; then
        echo "  [OK] Node.js installed"
        completed=$((completed + 1))
    else
        echo "  [ ] Node.js missing"
    fi
else
    echo "  [ ] Python3 missing"
fi
echo ""

# Step 3: Python environment
echo "[3/6] Python Environment:"
if [ -d "$APP_PATH/venv" ]; then
    echo "  [OK] Virtual environment exists"
    if [ -f "$APP_PATH/venv/bin/python" ]; then
        echo "  [OK] Python executable ready"
        completed=$((completed + 1))
    else
        echo "  [ ] Python executable missing"
    fi
else
    echo "  [ ] Virtual environment not created"
fi
echo ""

# Step 4: Dashboard build
echo "[4/6] Dashboard Build:"
if [ -d "$APP_PATH/dashboard/.next" ]; then
    echo "  [OK] Dashboard built"
    completed=$((completed + 1))
else
    echo "  [ ] Dashboard not built"
fi
echo ""

# Step 5: Systemd services
echo "[5/6] Systemd Services:"
if sudo systemctl list-unit-files | grep -q "polymarket-python.service"; then
    echo "  [OK] Services installed"
    completed=$((completed + 1))
else
    echo "  [ ] Services not installed"
fi
echo ""

# Step 6: Services running
echo "[6/6] Services Running:"
if sudo systemctl is-active --quiet polymarket-python 2>/dev/null; then
    echo "  [OK] Python service: RUNNING"
    python_running=1
else
    echo "  [ ] Python service: NOT RUNNING"
    python_running=0
fi

if sudo systemctl is-active --quiet polymarket-dashboard 2>/dev/null; then
    echo "  [OK] Dashboard service: RUNNING"
    dashboard_running=1
else
    echo "  [ ] Dashboard service: NOT RUNNING"
    dashboard_running=0
fi

if [ $python_running -eq 1 ] && [ $dashboard_running -eq 1 ]; then
    completed=$((completed + 1))
fi
echo ""

# Calculate percentage
percent=$((completed * 100 / total))
echo "==========================================="
echo "Progress: $completed/$total steps completed ($percent%)"
echo "==========================================="
'@

$statusScriptPath = Join-Path $env:TEMP "check_status.sh"
$statusScript | Out-File -FilePath $statusScriptPath -Encoding ASCII

# Upload and run status script
& pscp -i $PpkPath -P $VpsPort $statusScriptPath "${VpsUser}@${VpsHost}:/tmp/check_status.sh" | Out-Null
& plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" "chmod +x /tmp/check_status.sh && /tmp/check_status.sh" 2>&1

# Cleanup
Remove-Item $statusScriptPath -Force -ErrorAction SilentlyContinue
