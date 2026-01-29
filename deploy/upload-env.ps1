# Upload .env file to VPS
param(
    [Parameter(Mandatory=$true)]
    [string]$VpsHost,
    
    [Parameter(Mandatory=$true)]
    [string]$VpsUser,
    
    [Parameter(Mandatory=$false)]
    [int]$VpsPort = 22,
    
    [Parameter(Mandatory=$false)]
    [string]$PpkPath = ".\aws-aria.ppk",
    
    [Parameter(Mandatory=$false)]
    [string]$AppPath = "/opt/polymarket",
    
    [Parameter(Mandatory=$false)]
    [string]$EnvPath = ".\env"
)

$ErrorActionPreference = "Stop"

# Check if .env file exists
if (-not (Test-Path $EnvPath)) {
    Write-Host "ERROR: .env file not found: $EnvPath" -ForegroundColor Red
    Write-Host "Please create .env file or specify path with -EnvPath" -ForegroundColor Yellow
    exit 1
}

# Check for PuTTY tools
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $puttyPath) {
    Write-Host "ERROR: PuTTY tools (plink/pscp) not found in PATH" -ForegroundColor Red
    exit 1
}

# Check if PPK file exists
if (-not (Test-Path $PpkPath)) {
    Write-Host "ERROR: PPK file not found: $PpkPath" -ForegroundColor Red
    exit 1
}

Write-Host "Uploading .env file to VPS..." -ForegroundColor Yellow

# Upload .env file
& pscp -i $PpkPath -P $VpsPort "${EnvPath}" "${VpsUser}@${VpsHost}:${AppPath}/.env" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to upload .env file" -ForegroundColor Red
    exit 1
}

# Set proper permissions on remote server
$setPermsCmd = "chmod 600 ${AppPath}/.env"
& plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $setPermsCmd 2>&1 | Out-Null

Write-Host "✓ .env file uploaded successfully" -ForegroundColor Green
Write-Host ""
Write-Host "Restart services to apply changes:" -ForegroundColor Yellow
Write-Host "  plink -i $PpkPath -P $VpsPort -batch ${VpsUser}@${VpsHost} 'sudo systemctl restart polymarket-python polymarket-dashboard'" -ForegroundColor White
