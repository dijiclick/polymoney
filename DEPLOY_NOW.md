# Deploy to VPS - Quick Command

## Option 1: Interactive Deployment (Easiest)

Just run this command and follow the prompts:

```powershell
.\deploy\deploy-interactive.ps1
```

It will ask you for:
- VPS IP/hostname
- SSH username (default: ubuntu)
- SSH port (default: 22)

## Option 2: Direct Deployment

If you know your VPS details, run:

```powershell
.\deploy\deploy.ps1 -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu"
```

Then upload your .env file:
```powershell
.\deploy\upload-env.ps1 -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu"
```

And restart services:
```powershell
.\deploy\manage-services.ps1 -Action restart -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all
```

## What You Need

1. **VPS IP address or hostname** (e.g., `54.123.45.67` or `ec2-54-123-45-67.compute-1.amazonaws.com`)
2. **SSH username** (usually `ubuntu` for Ubuntu, `ec2-user` for Amazon Linux, `root` for some providers)
3. **SSH port** (usually `22`)

## Quick Test

Test your connection first:
```powershell
.\deploy\test-connection.ps1 -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu"
```

## After Deployment

Your services will be running at:
- **Dashboard**: `http://YOUR_VPS_IP:3000`
- **Python Service**: Running in background (monitoring trades)

Check status:
```powershell
.\deploy\manage-services.ps1 -Action status -VpsHost "YOUR_VPS_IP" -VpsUser "ubuntu" -Service all
```
