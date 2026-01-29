# Update server with latest code changes
param(
    [Parameter(Mandatory=$true)]
    [string]$VpsHost = "46.224.70.178",
    
    [Parameter(Mandatory=$false)]
    [string]$VpsUser = "root",
    
    [Parameter(Mandatory=$false)]
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("all", "python", "dashboard", "config")]
    [string]$UpdateType = "all"
)

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Update Server Deployment" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Check SSH key
if (-not (Test-Path $SshKeyPath)) {
    Write-Host "ERROR: SSH key not found: $SshKeyPath" -ForegroundColor Red
    exit 1
}

$AppPath = "/opt/polymarket"

# Update Python code
if ($UpdateType -eq "all" -or $UpdateType -eq "python") {
    Write-Host "[1/3] Uploading Python code..." -ForegroundColor Yellow
    & scp -i $SshKeyPath -o StrictHostKeyChecking=no -r "./src" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
    Write-Host "[OK] Python code uploaded" -ForegroundColor Green
    
    Write-Host "  Restarting Python service..." -ForegroundColor Gray
    & ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "sudo systemctl restart polymarket-python" 2>&1 | Out-Null
    Write-Host "[OK] Python service restarted" -ForegroundColor Green
    Write-Host ""
}

# Update Dashboard code
if ($UpdateType -eq "all" -or $UpdateType -eq "dashboard") {
    Write-Host "[2/3] Uploading Dashboard code..." -ForegroundColor Yellow
    & scp -i $SshKeyPath -o StrictHostKeyChecking=no -r "./dashboard/app" "./dashboard/components" "./dashboard/hooks" "./dashboard/lib" "${VpsUser}@${VpsHost}:${AppPath}/dashboard/" 2>&1 | Out-Null
    Write-Host "[OK] Dashboard code uploaded" -ForegroundColor Green
    
    Write-Host "  Rebuilding dashboard (1-2 minutes)..." -ForegroundColor Gray
    $rebuildResult = & ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "cd ${AppPath}/dashboard && npm run build" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Dashboard rebuilt" -ForegroundColor Green
        
        Write-Host "  Restarting Dashboard service..." -ForegroundColor Gray
        & ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "sudo systemctl restart polymarket-dashboard" 2>&1 | Out-Null
        Write-Host "[OK] Dashboard service restarted" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Dashboard build failed" -ForegroundColor Red
        Write-Host $rebuildResult -ForegroundColor Red
    }
    Write-Host ""
}

# Update config files
if ($UpdateType -eq "all" -or $UpdateType -eq "config") {
    Write-Host "[3/3] Uploading config files..." -ForegroundColor Yellow
    & scp -i $SshKeyPath -o StrictHostKeyChecking=no "./config.yaml" "./requirements.txt" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
    
    # If requirements.txt changed, reinstall packages
    Write-Host "  Checking if Python packages need update..." -ForegroundColor Gray
    & ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "cd ${AppPath} && source venv/bin/activate && pip install -r requirements.txt" 2>&1 | Out-Null
    
    Write-Host "[OK] Config files updated" -ForegroundColor Green
    Write-Host ""
}

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Update Complete!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Service Status:" -ForegroundColor Yellow
& ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "sudo systemctl status polymarket-python polymarket-dashboard --no-pager -l | head -15" 2>&1
Write-Host ""
Write-Host "Dashboard: http://${VpsHost}:3000" -ForegroundColor Cyan
Write-Host ""
