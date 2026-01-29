# Quick Start Guide - Deploy to VPS

## Prerequisites Checklist

- [ ] VPS with Ubuntu/Debian Linux
- [ ] SSH access to VPS (IP/hostname, username, port)
- [ ] PuTTY installed on Windows (for PPK support)
- [ ] `.env` file ready with all configuration

## Step-by-Step Deployment

### 1. Install PuTTY (if not already installed)

Download from: https://www.putty.org/
Or via Chocolatey: `choco install putty`

### 2. Prepare Your Environment

Make sure your `.env` file is ready:
```bash
cp .env.example .env
# Edit .env with your actual values
```

### 3. Deploy to VPS

Open PowerShell in the project root and run:

```powershell
.\deploy\deploy.ps1 -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu"
```

**Example:**
```powershell
.\deploy\deploy.ps1 -VpsHost "192.168.1.100" -VpsUser "ubuntu" -VpsPort 22
```

Or use the batch wrapper:
```cmd
.\deploy\deploy.bat 192.168.1.100 ubuntu
```

### 4. Upload Your .env File

```powershell
.\deploy\upload-env.ps1 -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu"
```

### 5. Restart Services

```powershell
.\deploy\manage-services.ps1 -Action restart -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all
```

### 6. Verify Services Are Running

```powershell
.\deploy\manage-services.ps1 -Action status -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all
```

## Common Commands

### Check Service Status
```powershell
.\deploy\manage-services.ps1 -Action status -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all
```

### View Logs
```powershell
# Last 50 lines
.\deploy\manage-services.ps1 -Action logs -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all

# Follow logs (live)
.\deploy\manage-services.ps1 -Action logs -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all -Follow
```

### Restart Services
```powershell
.\deploy\manage-services.ps1 -Action restart -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all
```

### Restart Specific Service
```powershell
# Python service only
.\deploy\manage-services.ps1 -Action restart -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service python

# Dashboard only
.\deploy\manage-services.ps1 -Action restart -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service dashboard
```

## Access Your Dashboard

Once deployed, your dashboard will be available at:
```
http://YOUR_VPS_IP:3000
```

Make sure port 3000 is open in your VPS firewall!

## Troubleshooting

### Service Won't Start
1. Check status: `.\deploy\manage-services.ps1 -Action status ...`
2. Check logs: `.\deploy\manage-services.ps1 -Action logs ...`
3. Verify `.env` file is uploaded correctly

### Can't Connect to VPS
1. Verify SSH credentials
2. Check if PPK file path is correct
3. Test connection manually: `plink -i .\aws-aria.ppk ubuntu@YOUR_VPS_IP`

### Dashboard Not Accessible
1. Check if service is running
2. Verify firewall allows port 3000
3. Check logs for errors

## What Gets Installed

- **Python 3** with virtual environment
- **Node.js** (LTS version)
- **System dependencies** (build tools, etc.)
- **Systemd services** for 24/7 operation
- **Firewall configuration** (basic)

## Services

Two systemd services are created:

1. **polymarket-python.service** - Python trade monitor service
2. **polymarket-dashboard.service** - Next.js dashboard

Both services:
- Start automatically on boot
- Auto-restart on failure
- Log to systemd journal

## Next Steps

After deployment:
1. Monitor logs to ensure everything is working
2. Set up monitoring/alerting (optional)
3. Configure backups (optional)
4. Set up domain name and reverse proxy (optional)

For detailed information, see [README.md](README.md)
