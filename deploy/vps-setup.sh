#!/bin/bash
# VPS Setup Script for Polymarket
# This script sets up the environment and dependencies on the VPS

set -e

APP_PATH="${1:-/opt/polymarket}"
echo "Setting up Polymarket at: $APP_PATH"

# Update system
echo "[1/7] Updating system packages..."
sudo apt-get update -qq
sudo apt-get upgrade -y -qq

# Install system dependencies
echo "[2/7] Installing system dependencies..."
sudo apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    git \
    build-essential \
    curl \
    wget \
    ufw \
    fail2ban

# Verify Node.js version (should be 18+)
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[2.5/7] Upgrading Node.js to latest LTS..."
    curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Setup Python virtual environment
echo "[3/7] Setting up Python virtual environment..."
cd "$APP_PATH"
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# Setup Node.js environment
echo "[4/7] Setting up Node.js environment..."
cd "$APP_PATH/dashboard"
npm ci --production
npm run build

# Create .env file if it doesn't exist
echo "[5/7] Checking .env file..."
cd "$APP_PATH"
if [ ! -f ".env" ]; then
    echo "WARNING: .env file not found!"
    echo "Please create .env file with your configuration:"
    echo "  cp .env.example .env"
    echo "  nano .env"
fi

# Setup firewall (optional but recommended)
echo "[6/7] Configuring firewall..."
if sudo ufw status | grep -q "Status: active"; then
    echo "Firewall already configured"
else
    echo "Setting up basic firewall rules..."
    sudo ufw allow 22/tcp   # SSH
    sudo ufw allow 3000/tcp # Dashboard
    sudo ufw --force enable
fi

# Install systemd services
echo "[7/7] Installing systemd services..."
sudo cp "$APP_PATH/deploy/systemd/polymarket-python.service" /etc/systemd/system/
sudo cp "$APP_PATH/deploy/systemd/polymarket-dashboard.service" /etc/systemd/system/

# Update service files with correct paths and user
sudo sed -i "s|/opt/polymarket|$APP_PATH|g" /etc/systemd/system/polymarket-*.service
sudo sed -i "s|User=ubuntu|User=$USER|g" /etc/systemd/system/polymarket-*.service

# Reload systemd
sudo systemctl daemon-reload

echo ""
echo "==========================================="
echo "  Setup Complete!"
echo "==========================================="
echo ""
echo "Next steps:"
echo "  1. Create/update .env file: nano $APP_PATH/.env"
echo "  2. Enable services:"
echo "     sudo systemctl enable polymarket-python.service"
echo "     sudo systemctl enable polymarket-dashboard.service"
echo "  3. Start services:"
echo "     sudo systemctl start polymarket-python.service"
echo "     sudo systemctl start polymarket-dashboard.service"
echo "  4. Check status:"
echo "     sudo systemctl status polymarket-python"
echo "     sudo systemctl status polymarket-dashboard"
echo ""
