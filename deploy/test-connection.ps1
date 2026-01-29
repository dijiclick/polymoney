# Test SSH connection to VPS
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

Write-Host "Testing connection to VPS..." -ForegroundColor Cyan
Write-Host "  Host: $VpsHost" -ForegroundColor Gray
Write-Host "  User: $VpsUser" -ForegroundColor Gray
Write-Host "  Port: $VpsPort" -ForegroundColor Gray
Write-Host "  Key: $PpkPath" -ForegroundColor Gray
Write-Host ""

# Check if PPK file exists
if (-not (Test-Path $PpkPath)) {
    Write-Host "ERROR: PPK file not found: $PpkPath" -ForegroundColor Red
    exit 1
}

# Check for PuTTY tools
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $puttyPath) {
    Write-Host "ERROR: PuTTY tools (plink) not found in PATH" -ForegroundColor Red
    Write-Host "Please install PuTTY from: https://www.putty.org/" -ForegroundColor Yellow
    exit 1
}

# Test connection
Write-Host "Connecting..." -ForegroundColor Yellow
$testCmd = "echo 'Connection successful!' && uname -a && uptime"
$result = & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $testCmd 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Connection successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "System Information:" -ForegroundColor Cyan
    $result | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
    Write-Host ""
    Write-Host "You can now proceed with deployment." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Connection failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Error output:" -ForegroundColor Yellow
    $result | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Verify VPS IP/hostname is correct" -ForegroundColor White
    Write-Host "  2. Check SSH port (default is 22)" -ForegroundColor White
    Write-Host "  3. Verify username is correct" -ForegroundColor White
    Write-Host "  4. Ensure PPK file is valid" -ForegroundColor White
    Write-Host "  5. Check VPS firewall allows SSH connections" -ForegroundColor White
    exit 1
}
