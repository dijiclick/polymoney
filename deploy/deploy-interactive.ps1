# Interactive Deployment Script
# Prompts for VPS details and deploys

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Polymarket VPS Deployment" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Get VPS details
$VpsHost = Read-Host "Enter VPS hostname or IP address"
$VpsUser = Read-Host "Enter SSH username (default: ubuntu)" 
if ([string]::IsNullOrWhiteSpace($VpsUser)) {
    $VpsUser = "ubuntu"
}

$VpsPortInput = Read-Host "Enter SSH port (default: 22)"
$VpsPort = 22
if (-not [string]::IsNullOrWhiteSpace($VpsPortInput)) {
    $VpsPort = [int]$VpsPortInput
}

# Check if .env exists
$envExists = Test-Path ".\env"
if (-not $envExists) {
    Write-Host ""
    Write-Host "WARNING: .env file not found!" -ForegroundColor Yellow
    $createEnv = Read-Host "Do you want to create .env from .env.example? (y/n)"
    if ($createEnv -eq "y" -or $createEnv -eq "Y") {
        if (Test-Path ".\env.example") {
            Copy-Item ".\env.example" ".\env"
            Write-Host "Created .env file. Please edit it with your configuration." -ForegroundColor Yellow
            Write-Host "Press any key to continue after editing .env..." -ForegroundColor Yellow
            $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
        }
    }
}

Write-Host ""
Write-Host "Starting deployment..." -ForegroundColor Green
Write-Host "  Host: $VpsHost" -ForegroundColor Gray
Write-Host "  User: $VpsUser" -ForegroundColor Gray
Write-Host "  Port: $VpsPort" -ForegroundColor Gray
Write-Host ""

# Test connection first
Write-Host "Testing connection..." -ForegroundColor Yellow
& .\deploy\test-connection.ps1 -VpsHost $VpsHost -VpsUser $VpsUser -VpsPort $VpsPort

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Connection test failed. Please check your VPS details." -ForegroundColor Red
    exit 1
}

Write-Host ""
$continue = Read-Host "Connection successful! Continue with deployment? (y/n)"
if ($continue -ne "y" -and $continue -ne "Y") {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

# Run deployment
Write-Host ""
& .\deploy\deploy.ps1 -VpsHost $VpsHost -VpsUser $VpsUser -VpsPort $VpsPort

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    $uploadEnv = Read-Host "Deployment complete! Upload .env file now? (y/n)"
    if ($uploadEnv -eq "y" -or $uploadEnv -eq "Y") {
        if (Test-Path ".\env") {
            & .\deploy\upload-env.ps1 -VpsHost $VpsHost -VpsUser $VpsUser -VpsPort $VpsPort
            Write-Host ""
            $restart = Read-Host "Restart services to apply .env changes? (y/n)"
            if ($restart -eq "y" -or $restart -eq "Y") {
                & .\deploy\manage-services.ps1 -Action restart -VpsHost $VpsHost -VpsUser $VpsUser -VpsPort $VpsPort -Service all
            }
        } else {
            Write-Host "ERROR: .env file not found. Please upload it manually." -ForegroundColor Red
        }
    }
    
    Write-Host ""
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host "  Deployment Process Complete!" -ForegroundColor Green
    Write-Host "===========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Check service status:" -ForegroundColor Yellow
    Write-Host "  .\deploy\manage-services.ps1 -Action status -VpsHost `"$VpsHost`" -VpsUser `"$VpsUser`" -Service all" -ForegroundColor White
}
