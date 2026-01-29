# Connect to VPS and get information
# This script helps discover and connect to your VPS

param(
    [Parameter(Mandatory=$false)]
    [string]$VpsHost = "",
    
    [Parameter(Mandatory=$false)]
    [string]$VpsUser = "ubuntu",
    
    [Parameter(Mandatory=$false)]
    [int]$VpsPort = 22,
    
    [Parameter(Mandatory=$false)]
    [string]$PpkPath = ".\aws-aria.ppk"
)

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  VPS Connection Helper" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Check if PPK exists
if (-not (Test-Path $PpkPath)) {
    Write-Host "ERROR: PPK file not found: $PpkPath" -ForegroundColor Red
    exit 1
}

# Check for PuTTY
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $puttyPath) {
    Write-Host "ERROR: PuTTY tools (plink) not found in PATH" -ForegroundColor Red
    Write-Host "Please install PuTTY from: https://www.putty.org/" -ForegroundColor Yellow
    exit 1
}

# If VPS host not provided, prompt for it
if ([string]::IsNullOrWhiteSpace($VpsHost)) {
    Write-Host "I need your VPS connection details to connect." -ForegroundColor Yellow
    Write-Host ""
    $VpsHost = Read-Host "Enter VPS IP address or hostname"
    
    if ([string]::IsNullOrWhiteSpace($VpsHost)) {
        Write-Host "ERROR: VPS host is required" -ForegroundColor Red
        exit 1
    }
    
    $userInput = Read-Host "Enter SSH username (default: ubuntu)"
    if (-not [string]::IsNullOrWhiteSpace($userInput)) {
        $VpsUser = $userInput
    }
    
    $portInput = Read-Host "Enter SSH port (default: 22)"
    if (-not [string]::IsNullOrWhiteSpace($portInput)) {
        $VpsPort = [int]$portInput
    }
}

Write-Host ""
Write-Host "Attempting to connect to:" -ForegroundColor Cyan
Write-Host "  Host: $VpsHost" -ForegroundColor White
Write-Host "  User: $VpsUser" -ForegroundColor White
Write-Host "  Port: $VpsPort" -ForegroundColor White
Write-Host "  Key: $PpkPath" -ForegroundColor White
Write-Host ""

# Test connection
Write-Host "Testing connection..." -ForegroundColor Yellow
$testCmd = "echo '=== VPS Information ===' && uname -a && echo '' && echo '=== System Uptime ===' && uptime && echo '' && echo '=== Disk Space ===' && df -h / && echo '' && echo '=== Memory ===' && free -h && echo '' && echo '=== Python Version ===' && python3 --version 2>/dev/null || echo 'Python not installed' && echo '' && echo '=== Node Version ===' && node --version 2>/dev/null || echo 'Node not installed'"

$result = & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $testCmd 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Connection successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host $result -ForegroundColor White
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "  Connection Established" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "You can now:" -ForegroundColor Yellow
    Write-Host "  1. Deploy your system: .\deploy\deploy.ps1 -VpsHost `"$VpsHost`" -VpsUser `"$VpsUser`"" -ForegroundColor White
    Write-Host "  2. Check if services are already running:" -ForegroundColor White
    Write-Host "     .\deploy\manage-services.ps1 -Action status -VpsHost `"$VpsHost`" -VpsUser `"$VpsUser`" -Service all" -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "Connection failed!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Error output:" -ForegroundColor Yellow
    $result | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  1. Verify VPS IP/hostname: $VpsHost" -ForegroundColor White
    Write-Host "  2. Check SSH port: $VpsPort" -ForegroundColor White
    Write-Host "  3. Verify username: $VpsUser" -ForegroundColor White
    Write-Host "  4. Ensure PPK file is valid: $PpkPath" -ForegroundColor White
    Write-Host "  5. Check VPS firewall allows SSH on port $VpsPort" -ForegroundColor White
    Write-Host "  6. If AWS EC2, check Security Group allows SSH" -ForegroundColor White
    exit 1
}
