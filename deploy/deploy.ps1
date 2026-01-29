# Polymarket VPS Deployment Script
# This script deploys the application to your VPS and sets it up to run 24/7

param(
    [Parameter(Mandatory=$true)]
    [string]$VpsHost,
    
    [Parameter(Mandatory=$true)]
    [string]$VpsUser,
    
    [Parameter(Mandatory=$false)]
    [int]$VpsPort = 22,
    
    [Parameter(Mandatory=$false)]
    [string]$PpkPath = "",
    
    [Parameter(Mandatory=$false)]
    [string]$SshKeyPath = "",
    
    [Parameter(Mandatory=$false)]
    [string]$AppPath = "/opt/polymarket",
    
    [Parameter(Mandatory=$false)]
    [switch]$SkipUpload = $false
)

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Polymarket VPS Deployment" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Check for PuTTY tools
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $puttyPath) {
    Write-Host "ERROR: PuTTY tools (plink/pscp) not found in PATH" -ForegroundColor Red
    Write-Host "Please install PuTTY from: https://www.putty.org/" -ForegroundColor Yellow
    Write-Host "Or add PuTTY to your PATH" -ForegroundColor Yellow
    exit 1
}

# Check if PPK file exists
if (-not (Test-Path $PpkPath)) {
    Write-Host "ERROR: PPK file not found: $PpkPath" -ForegroundColor Red
    exit 1
}

# Convert PPK to OpenSSH format (temporary)
Write-Host "[1/6] Converting PPK to OpenSSH format..." -ForegroundColor Yellow
$tempKey = "$env:TEMP\polymarket_deploy_key"
try {
    # Use puttygen to convert PPK to OpenSSH
    $puttygenPath = Get-Command puttygen -ErrorAction SilentlyContinue
    if ($puttygenPath) {
        & puttygen $PpkPath -O private-openssh -o $tempKey 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "puttygen conversion failed"
        }
    } else {
        Write-Host "WARNING: puttygen not found. Using PPK directly with plink..." -ForegroundColor Yellow
        $tempKey = $PpkPath
    }
} catch {
    Write-Host "WARNING: Could not convert PPK. Using PPK directly..." -ForegroundColor Yellow
    $tempKey = $PpkPath
}

# Test SSH connection
Write-Host "[2/6] Testing SSH connection..." -ForegroundColor Yellow
$testCmd = "echo 'Connection test successful'"
if ($tempKey -ne $PpkPath) {
    $sshArgs = "-i", $tempKey, "-p", $VpsPort, "-o", "StrictHostKeyChecking=no", "${VpsUser}@${VpsHost}", $testCmd
    $result = & ssh @sshArgs 2>&1
} else {
    $result = & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $testCmd 2>&1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to connect to VPS" -ForegroundColor Red
    Write-Host $result -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Connection successful" -ForegroundColor Green

# Upload files
if (-not $SkipUpload) {
    Write-Host "[3/6] Uploading files to VPS..." -ForegroundColor Yellow
    
    # Create remote directory
    $createDirCmd = "sudo mkdir -p $AppPath; sudo chown `$USER:`$USER $AppPath"
    if ($tempKey -ne $PpkPath) {
        & ssh -i $tempKey -p $VpsPort -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" $createDirCmd | Out-Null
    } else {
        & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $createDirCmd | Out-Null
    }
    
    # Upload files using pscp (excluding large directories)
    Write-Host "  Uploading project files..." -ForegroundColor Gray
    Write-Host "  Note: Excluding node_modules, venv, .git, .next for faster upload" -ForegroundColor Gray
    
    # Use rsync-like approach: upload everything, then clean up on server
    if ($tempKey -ne $PpkPath) {
        & scp -i $tempKey -P $VpsPort -r -o StrictHostKeyChecking=no ".\*" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
    } else {
        # pscp doesn't support exclude, so we'll upload and clean up on server
        & pscp -i $PpkPath -P $VpsPort -r ".\*" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
    }
    
    # Clean up excluded directories on server
    $cleanupCmd = "cd $AppPath; rm -rf node_modules venv .git __pycache__ .next 2>/dev/null; find . -name '*.pyc' -delete 2>/dev/null; echo 'Cleanup done'"
    if ($tempKey -ne $PpkPath) {
        & ssh -i $tempKey -p $VpsPort -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" $cleanupCmd | Out-Null
    } else {
        & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $cleanupCmd | Out-Null
    }
    
    Write-Host "[OK] Files uploaded" -ForegroundColor Green
} else {
    Write-Host "[3/6] Skipping file upload (--SkipUpload)" -ForegroundColor Yellow
}

# Run setup script on VPS
Write-Host "[4/6] Running setup script on VPS..." -ForegroundColor Yellow

$setupScript = @"
#!/bin/bash
set -e
cd $AppPath

# Install system dependencies
echo "Installing system dependencies..."
sudo apt-get update -qq
# Check if nodejs is installed (it usually includes npm)
if ! command -v node &> /dev/null; then
    sudo apt-get install -y nodejs
fi
# Install other dependencies
sudo apt-get install -y python3 python3-pip python3-venv git build-essential

# Setup Python environment
echo "Setting up Python environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt

# Setup Node.js environment
echo "Setting up Node.js environment..."
cd dashboard
npm ci --production
npm run build
cd ..

echo "Setup completed successfully!"
"@

# Upload and run setup script
$setupScriptPath = Join-Path $env:TEMP "vps_setup.sh"
# Use ASCII encoding to avoid BOM issues
$setupScript | Out-File -FilePath $setupScriptPath -Encoding ASCII -NoNewline
# Add newline at end
Add-Content -Path $setupScriptPath -Value "`n" -NoNewline

if ($tempKey -ne $PpkPath) {
    & scp -i $tempKey -P $VpsPort -o StrictHostKeyChecking=no $setupScriptPath "${VpsUser}@${VpsHost}:/tmp/setup.sh" | Out-Null
    & ssh -i $tempKey -p $VpsPort -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "chmod +x /tmp/setup.sh; /tmp/setup.sh" 2>&1
} else {
    & pscp -i $PpkPath -P $VpsPort $setupScriptPath "${VpsUser}@${VpsHost}:/tmp/setup.sh" | Out-Null
    & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" "chmod +x /tmp/setup.sh; /tmp/setup.sh" 2>&1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Setup script failed" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Setup completed" -ForegroundColor Green

# Install systemd services
Write-Host "[5/6] Installing systemd services..." -ForegroundColor Yellow

$systemdScript = @'
#!/bin/bash
set -e
APP_PATH="'@ + $AppPath + @'"
VPS_USER="'@ + $VpsUser + @'"

# Create systemd service for Python service
sudo tee /etc/systemd/system/polymarket-python.service > /dev/null <<EOF
[Unit]
Description=Polymarket Python Trade Monitor Service
After=network.target

[Service]
Type=simple
User=$VPS_USER
WorkingDirectory=$APP_PATH
Environment="PATH=$APP_PATH/venv/bin:/usr/local/bin:/usr/bin:/bin"
EnvironmentFile=$APP_PATH/.env
ExecStart=$APP_PATH/venv/bin/python -m src.realtime.service
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create systemd service for Next.js dashboard
sudo tee /etc/systemd/system/polymarket-dashboard.service > /dev/null <<EOF
[Unit]
Description=Polymarket Next.js Dashboard
After=network.target

[Service]
Type=simple
User=$VPS_USER
WorkingDirectory=$APP_PATH/dashboard
Environment="NODE_ENV=production"
Environment="PORT=3000"
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable services
sudo systemctl daemon-reload
sudo systemctl enable polymarket-python.service
sudo systemctl enable polymarket-dashboard.service

echo "Systemd services installed and enabled"
'@

$systemdScriptPath = Join-Path $env:TEMP "install_systemd.sh"
# Use ASCII encoding to avoid BOM issues  
$systemdScript | Out-File -FilePath $systemdScriptPath -Encoding ASCII -NoNewline
Add-Content -Path $systemdScriptPath -Value "`n" -NoNewline

if ($tempKey -ne $PpkPath) {
    & scp -i $tempKey -P $VpsPort -o StrictHostKeyChecking=no $systemdScriptPath "${VpsUser}@${VpsHost}:/tmp/install_systemd.sh" | Out-Null
    & ssh -i $tempKey -p $VpsPort -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "chmod +x /tmp/install_systemd.sh; /tmp/install_systemd.sh" 2>&1
} else {
    & pscp -i $PpkPath -P $VpsPort $systemdScriptPath "${VpsUser}@${VpsHost}:/tmp/install_systemd.sh" | Out-Null
    & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" "chmod +x /tmp/install_systemd.sh; /tmp/install_systemd.sh" 2>&1
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install systemd services" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Systemd services installed" -ForegroundColor Green

# Start services
Write-Host "[6/6] Starting services..." -ForegroundColor Yellow

$startCmd = "sudo systemctl start polymarket-python.service; sudo systemctl start polymarket-dashboard.service; sleep 2; sudo systemctl status polymarket-python.service --no-pager -l; sudo systemctl status polymarket-dashboard.service --no-pager -l"
if ($tempKey -ne $PpkPath) {
    & ssh -i $tempKey -p $VpsPort -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" $startCmd 2>&1
} else {
    & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $startCmd 2>&1
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Services are now running 24/7 on your VPS:" -ForegroundColor Green
Write-Host "  - Python Service: systemctl status polymarket-python" -ForegroundColor White
Write-Host "  - Dashboard: systemctl status polymarket-dashboard" -ForegroundColor White
Write-Host ""
Write-Host "IMPORTANT: Don't forget to:" -ForegroundColor Yellow
Write-Host "  1. Upload your .env file to $AppPath/.env" -ForegroundColor Yellow
Write-Host "  2. Restart services: sudo systemctl restart polymarket-python polymarket-dashboard" -ForegroundColor Yellow
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Cyan
Write-Host "  View logs: sudo journalctl -u polymarket-python -f" -ForegroundColor White
Write-Host "  View dashboard logs: sudo journalctl -u polymarket-dashboard -f" -ForegroundColor White
Write-Host "  Restart services: sudo systemctl restart polymarket-python polymarket-dashboard" -ForegroundColor White
Write-Host "  Stop services: sudo systemctl stop polymarket-python polymarket-dashboard" -ForegroundColor White
Write-Host ""

# Cleanup
if (Test-Path $tempKey -and $tempKey -ne $PpkPath) {
    Remove-Item $tempKey -Force -ErrorAction SilentlyContinue
}
Remove-Item $setupScriptPath -Force -ErrorAction SilentlyContinue
Remove-Item $systemdScriptPath -Force -ErrorAction SilentlyContinue
