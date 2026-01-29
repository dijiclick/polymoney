# Polymarket VPS Deployment Guide

This guide will help you deploy your Polymarket analytics system to a VPS and run it 24/7.

## Prerequisites

1. **VPS with Ubuntu/Debian Linux** (tested on Ubuntu 20.04+)
2. **SSH access** to your VPS
3. **PuTTY tools** installed on Windows (for PPK file support):
   - Download from: https://www.putty.org/
   - Or install via: `choco install putty` (if you have Chocolatey)
4. **Your `.env` file** with all required configuration

## Quick Start

### Option 1: Automated Deployment (Recommended)

1. **Open PowerShell** in the project root directory

2. **Run the deployment script:**
   ```powershell
   .\deploy\deploy.ps1 -VpsHost "your-vps-ip-or-hostname" -VpsUser "ubuntu"
   ```

   Or use the batch wrapper:
   ```cmd
   .\deploy\deploy.bat your-vps-ip-or-hostname ubuntu
   ```

3. **Upload your `.env` file:**
   ```powershell
   scp -i .\aws-aria.ppk .env ubuntu@your-vps-ip:/opt/polymarket/.env
   ```
   
   Or using pscp (PuTTY):
   ```cmd
   pscp -i .\aws-aria.ppk .env ubuntu@your-vps-ip:/opt/polymarket/.env
   ```

4. **Restart services:**
   ```powershell
   plink -i .\aws-aria.ppk ubuntu@your-vps-ip "sudo systemctl restart polymarket-python polymarket-dashboard"
   ```

### Option 2: Manual Deployment

1. **Connect to your VPS:**
   ```bash
   ssh -i aws-aria.ppk ubuntu@your-vps-ip
   ```

2. **Clone or upload your project:**
   ```bash
   sudo mkdir -p /opt/polymarket
   sudo chown $USER:$USER /opt/polymarket
   # Upload files using scp/rsync or git clone
   ```

3. **Run the setup script:**
   ```bash
   cd /opt/polymarket
   chmod +x deploy/vps-setup.sh
   ./deploy/vps-setup.sh /opt/polymarket
   ```

4. **Create `.env` file:**
   ```bash
   cp .env.example .env
   nano .env
   # Fill in all required values
   ```

5. **Enable and start services:**
   ```bash
   sudo systemctl enable polymarket-python.service
   sudo systemctl enable polymarket-dashboard.service
   sudo systemctl start polymarket-python.service
   sudo systemctl start polymarket-dashboard.service
   ```

## Converting PPK to OpenSSH Format (Optional)

If you prefer using standard SSH tools instead of PuTTY:

1. **Install PuTTYgen** (comes with PuTTY)

2. **Convert PPK to OpenSSH:**
   ```powershell
   puttygen aws-aria.ppk -O private-openssh -o aws-aria.pem
   ```

3. **Set proper permissions:**
   ```bash
   # On Linux/Mac
   chmod 600 aws-aria.pem
   ```

4. **Use with standard SSH:**
   ```bash
   ssh -i aws-aria.pem ubuntu@your-vps-ip
   ```

## Managing Services

### Check Service Status

```bash
sudo systemctl status polymarket-python
sudo systemctl status polymarket-dashboard
```

### View Logs

```bash
# Python service logs
sudo journalctl -u polymarket-python -f

# Dashboard logs
sudo journalctl -u polymarket-dashboard -f

# Both services
sudo journalctl -u polymarket-python -u polymarket-dashboard -f
```

### Restart Services

```bash
sudo systemctl restart polymarket-python
sudo systemctl restart polymarket-dashboard
```

### Stop Services

```bash
sudo systemctl stop polymarket-python
sudo systemctl stop polymarket-dashboard
```

### Start Services

```bash
sudo systemctl start polymarket-python
sudo systemctl start polymarket-dashboard
```

### Disable Auto-Start (if needed)

```bash
sudo systemctl disable polymarket-python
sudo systemctl disable polymarket-dashboard
```

## Updating the Application

### Method 1: Using Git (if repository is on VPS)

```bash
cd /opt/polymarket
git pull origin main

# Update Python dependencies
source venv/bin/activate
pip install -r requirements.txt

# Rebuild dashboard
cd dashboard
npm ci
npm run build
cd ..

# Restart services
sudo systemctl restart polymarket-python polymarket-dashboard
```

### Method 2: Re-upload Files

1. **Upload updated files** using scp/rsync
2. **Run setup again** (or just update dependencies)
3. **Restart services**

## Troubleshooting

### Service Won't Start

1. **Check service status:**
   ```bash
   sudo systemctl status polymarket-python -l
   ```

2. **Check logs:**
   ```bash
   sudo journalctl -u polymarket-python -n 50
   ```

3. **Verify .env file exists and has correct values:**
   ```bash
   cat /opt/polymarket/.env
   ```

4. **Test Python service manually:**
   ```bash
   cd /opt/polymarket
   source venv/bin/activate
   python -m src.realtime.service
   ```

### Dashboard Not Accessible

1. **Check if dashboard is running:**
   ```bash
   sudo systemctl status polymarket-dashboard
   ```

2. **Check if port 3000 is open:**
   ```bash
   sudo ufw status
   sudo netstat -tlnp | grep 3000
   ```

3. **Check firewall rules:**
   ```bash
   sudo ufw allow 3000/tcp
   ```

4. **Test dashboard manually:**
   ```bash
   cd /opt/polymarket/dashboard
   npm start
   ```

### Connection Issues

1. **Test SSH connection:**
   ```bash
   ssh -i aws-aria.ppk ubuntu@your-vps-ip
   ```

2. **If using PPK, make sure PuTTY tools are in PATH**

3. **Check VPS firewall settings**

### Python Environment Issues

1. **Recreate virtual environment:**
   ```bash
   cd /opt/polymarket
   rm -rf venv
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

### Node.js Issues

1. **Update Node.js to LTS:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
   sudo apt-get install -y nodejs
   ```

2. **Rebuild dashboard:**
   ```bash
   cd /opt/polymarket/dashboard
   rm -rf node_modules .next
   npm ci
   npm run build
   ```

## Security Recommendations

1. **Use a non-root user** (already configured in systemd services)
2. **Keep system updated:**
   ```bash
   sudo apt-get update && sudo apt-get upgrade -y
   ```
3. **Configure fail2ban** (already installed by setup script)
4. **Use SSH keys** instead of passwords
5. **Restrict firewall** to only necessary ports
6. **Keep .env file secure** (chmod 600)
7. **Regular backups** of your database and configuration

## Monitoring

### Set up monitoring (optional)

You can use tools like:
- **PM2** (alternative to systemd)
- **Supervisor**
- **Monit**
- **Uptime monitoring services** (UptimeRobot, Pingdom, etc.)

### Health Check Endpoints

The dashboard should be accessible at:
- `http://your-vps-ip:3000`

Monitor the Python service through logs and database activity.

## Backup Strategy

1. **Database backups** (if using Supabase, check their backup policy)
2. **Configuration backup:**
   ```bash
   tar -czf polymarket-backup-$(date +%Y%m%d).tar.gz \
     /opt/polymarket/.env \
     /opt/polymarket/config.yaml
   ```

## Support

If you encounter issues:
1. Check the logs first
2. Verify all environment variables are set
3. Test services manually
4. Check system resources (CPU, memory, disk)

## Notes

- Services are configured to **auto-restart** on failure
- Services start **automatically on boot**
- Logs are stored in **systemd journal**
- Default app path: `/opt/polymarket`
- Dashboard runs on port **3000** (change in service file if needed)
