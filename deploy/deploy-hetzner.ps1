# Deploy to Hetzner using OpenSSH key
param(
    [Parameter(Mandatory=$true)]
    [string]$VpsHost,
    
    [Parameter(Mandatory=$false)]
    [string]$VpsUser = "root",
    
    [Parameter(Mandatory=$false)]
    [int]$VpsPort = 22,
    
    [Parameter(Mandatory=$false)]
    [string]$SshKeyPath = "$env:USERPROFILE\.ssh\id_ed25519",
    
    [Parameter(Mandatory=$false)]
    [string]$AppPath = "/opt/polymarket"
)

$ErrorActionPreference = "Stop"

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Polymarket Hetzner Deployment" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Check if SSH key exists
if (-not (Test-Path $SshKeyPath)) {
    Write-Host "ERROR: SSH key not found: $SshKeyPath" -ForegroundColor Red
    exit 1
}

# Check for SSH
$sshPath = Get-Command ssh -ErrorAction SilentlyContinue
if (-not $sshPath) {
    Write-Host "ERROR: SSH not found in PATH" -ForegroundColor Red
    exit 1
}

# Test connection
Write-Host "[1/6] Testing SSH connection..." -ForegroundColor Yellow
$testResult = & ssh -i $SshKeyPath -o StrictHostKeyChecking=no -o ConnectTimeout=10 "${VpsUser}@${VpsHost}" "echo 'Connection successful' && uname -a" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to connect to VPS" -ForegroundColor Red
    Write-Host $testResult -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Connection successful" -ForegroundColor Green
Write-Host $testResult -ForegroundColor Gray
Write-Host ""

# Upload files
Write-Host "[2/6] Uploading files to VPS..." -ForegroundColor Yellow

# Create remote directory
& ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "mkdir -p $AppPath" | Out-Null

# Upload files using scp (excluding large directories)
Write-Host "  Uploading project files (this may take a few minutes)..." -ForegroundColor Gray

# Use rsync if available, otherwise scp
$rsyncPath = Get-Command rsync -ErrorAction SilentlyContinue
if ($rsyncPath) {
    & rsync -avz --exclude 'node_modules' --exclude 'venv' --exclude '.git' --exclude '__pycache__' --exclude '*.pyc' --exclude '.next' --exclude '.env' -e "ssh -i $SshKeyPath -o StrictHostKeyChecking=no" "./" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
} else {
    # Fallback to scp - upload key files first
    & scp -i $SshKeyPath -o StrictHostKeyChecking=no -r -q "./src" "./dashboard" "./requirements.txt" "./config.yaml" "./.env.example" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
    
    # Upload deploy directory
    & scp -i $SshKeyPath -o StrictHostKeyChecking=no -r -q "./deploy" "${VpsUser}@${VpsHost}:${AppPath}/" 2>&1 | Out-Null
}

Write-Host "[OK] Files uploaded" -ForegroundColor Green
Write-Host ""

# Run setup script
Write-Host "[3/6] Running setup script on VPS..." -ForegroundColor Yellow

$setupScript = @"
#!/bin/bash
set -e
cd $AppPath

# Install system dependencies
echo "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -qq
sudo apt-get install -y python3 python3-pip python3-venv git build-essential curl wget

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Setup Python environment
echo "Setting up Python environment..."
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# Setup Node.js environment
echo "Setting up Node.js environment..."
cd dashboard
npm ci
npm run build
cd ..

echo "Setup completed successfully!"
"@

# Upload and run setup script
$setupScriptPath = Join-Path $env:TEMP "vps_setup.sh"
$setupScript | Out-File -FilePath $setupScriptPath -Encoding ASCII

& scp -i $SshKeyPath -o StrictHostKeyChecking=no $setupScriptPath "${VpsUser}@${VpsHost}:/tmp/setup.sh" | Out-Null
& ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "chmod +x /tmp/setup.sh && /tmp/setup.sh" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Setup script failed" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Setup completed" -ForegroundColor Green
Write-Host ""

# Install systemd services
Write-Host "[4/6] Installing systemd services..." -ForegroundColor Yellow

$systemdScript = @"
#!/bin/bash
set -e
APP_PATH="$AppPath"
VPS_USER="$VpsUser"

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
LimitNOFILE=65536

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
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and enable services
sudo systemctl daemon-reload
sudo systemctl enable polymarket-python.service
sudo systemctl enable polymarket-dashboard.service

echo "Systemd services installed and enabled"
"@

$systemdScriptPath = Join-Path $env:TEMP "install_systemd.sh"
$systemdScript | Out-File -FilePath $systemdScriptPath -Encoding ASCII

& scp -i $SshKeyPath -o StrictHostKeyChecking=no $systemdScriptPath "${VpsUser}@${VpsHost}:/tmp/install_systemd.sh" | Out-Null
& ssh -i $SshKeyPath -o StrictHostKeyChecking=no "${VpsUser}@${VpsHost}" "chmod +x /tmp/install_systemd.sh && /tmp/install_systemd.sh" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to install systemd services" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Systemd services installed" -ForegroundColor Green
Write-Host ""

# Start services (but they'll need .env file first)
Write-Host "[5/6] Services configured (will start after .env is uploaded)..." -ForegroundColor Yellow
Write-Host "[OK] Services ready" -ForegroundColor Green
Write-Host ""

Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Deployment Complete!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Upload your .env file:" -ForegroundColor White
Write-Host "     scp -i $SshKeyPath .env ${VpsUser}@${VpsHost}:${AppPath}/.env" -ForegroundColor Gray
Write-Host ""
Write-Host "  2. Start services:" -ForegroundColor White
Write-Host "     ssh -i $SshKeyPath ${VpsUser}@${VpsHost} 'sudo systemctl start polymarket-python polymarket-dashboard'" -ForegroundColor Gray
Write-Host ""
Write-Host "  3. Check status:" -ForegroundColor White
Write-Host "     ssh -i $SshKeyPath ${VpsUser}@${VpsHost} 'sudo systemctl status polymarket-python polymarket-dashboard'" -ForegroundColor Gray
Write-Host ""
Write-Host "Dashboard will be available at: http://${VpsHost}:3000" -ForegroundColor Cyan
Write-Host ""

# Cleanup
Remove-Item $setupScriptPath -Force -ErrorAction SilentlyContinue
Remove-Item $systemdScriptPath -Force -ErrorAction SilentlyContinue
