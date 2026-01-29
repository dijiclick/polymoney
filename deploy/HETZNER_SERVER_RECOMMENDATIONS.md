# Hetzner Server Recommendations for Polymarket System

## Application Requirements

Your Polymarket system consists of:
- **Python Service**: Real-time trade monitoring with WebSocket connections, data processing (pandas/numpy)
- **Next.js Dashboard**: React application serving on port 3000
- **Database**: Supabase (external, not hosted on VPS)

## Recommended Hetzner Server Options

### Option 1: CPX11 (Recommended Starting Point)
**Price**: ~€4.51/month
- **CPU**: 2 vCPU
- **RAM**: 2 GB
- **Disk**: 40 GB NVMe SSD
- **Network**: 20 TB traffic
- **Best for**: Development, testing, or low-traffic production

### Option 2: CPX21 (Recommended for Production)
**Price**: ~€8.91/month
- **CPU**: 3 vCPU
- **RAM**: 4 GB
- **Disk**: 80 GB NVMe SSD
- **Network**: 20 TB traffic
- **Best for**: Production use with moderate traffic

### Option 3: CPX31 (For High Traffic)
**Price**: ~€17.81/month
- **CPU**: 4 vCPU
- **RAM**: 8 GB
- **Disk**: 160 GB NVMe SSD
- **Network**: 20 TB traffic
- **Best for**: High-traffic production with many concurrent users

### Option 4: CCX11 (Dedicated CPU - Better Performance)
**Price**: ~€15.90/month
- **CPU**: 2 dedicated vCPU
- **RAM**: 4 GB
- **Disk**: 40 GB NVMe SSD
- **Network**: 20 TB traffic
- **Best for**: Consistent performance, no CPU sharing

## My Recommendation

**Start with CPX21** (~€8.91/month):
- ✅ Enough CPU (3 vCPU) for both services
- ✅ Sufficient RAM (4 GB) for Python data processing
- ✅ Good disk space (80 GB) for logs and growth
- ✅ Great price/performance ratio
- ✅ Can upgrade later if needed

## Server Configuration Steps

1. **Location**: Choose closest to your users (Falkenstein, Nuremberg, or Helsinki)
2. **OS**: Ubuntu 24.04 LTS (recommended) or Ubuntu 22.04 LTS
3. **SSH Key**: Upload your SSH public key during server creation
4. **Firewall**: Enable Hetzner Cloud Firewall (allow SSH port 22 and port 3000)

## After Server Creation

Once you have your Hetzner server:
1. Note the **IP address**
2. Note the **SSH username** (usually `root` for Hetzner)
3. Get your **SSH private key** (or convert PPK if needed)
4. Run the deployment script with your Hetzner server details

## Resource Usage Estimates

- **Idle**: ~200-300 MB RAM, minimal CPU
- **Normal operation**: ~500 MB - 1 GB RAM, 10-30% CPU
- **Peak load**: ~1.5-2 GB RAM, 50-70% CPU
- **Disk**: ~5-10 GB for OS + dependencies, ~1-2 GB for logs

## Upgrade Path

You can easily upgrade your Hetzner server later:
- CPX11 → CPX21 → CPX31 (vertical scaling)
- Or add more servers (horizontal scaling)

## Cost Comparison

- **Hetzner CPX21**: ~€8.91/month (~$9.70/month)
- **AWS t3.small** (similar): ~$15/month
- **Savings**: ~35% cheaper with Hetzner!

## Next Steps

After creating your Hetzner server, provide me with:
- Server IP address
- SSH username (usually `root`)
- SSH key file (or I can help convert your PPK)

Then I'll deploy everything automatically! 🚀
