# Manage services on VPS
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("status", "start", "stop", "restart", "logs")]
    [string]$Action,
    
    [Parameter(Mandatory=$true)]
    [string]$VpsHost,
    
    [Parameter(Mandatory=$true)]
    [string]$VpsUser,
    
    [Parameter(Mandatory=$false)]
    [int]$VpsPort = 22,
    
    [Parameter(Mandatory=$false)]
    [string]$PpkPath = ".\aws-aria.ppk",
    
    [Parameter(Mandatory=$false)]
    [ValidateSet("python", "dashboard", "all")]
    [string]$Service = "all",
    
    [Parameter(Mandatory=$false)]
    [switch]$Follow
)

$ErrorActionPreference = "Stop"

# Check for PuTTY tools
$puttyPath = Get-Command plink -ErrorAction SilentlyContinue
if (-not $puttyPath) {
    Write-Host "ERROR: PuTTY tools (plink) not found in PATH" -ForegroundColor Red
    exit 1
}

# Check if PPK file exists
if (-not (Test-Path $PpkPath)) {
    Write-Host "ERROR: PPK file not found: $PpkPath" -ForegroundColor Red
    exit 1
}

$services = @()
if ($Service -eq "all") {
    $services = @("polymarket-python", "polymarket-dashboard")
} else {
    $services = @("polymarket-$Service")
}

$sshCmd = ""
switch ($Action) {
    "status" {
        $cmds = $services | ForEach-Object { "sudo systemctl status $_ --no-pager -l" }
        $sshCmd = ($cmds -join " && echo '---' && ")
    }
    "start" {
        $cmds = $services | ForEach-Object { "sudo systemctl start $_" }
        $sshCmd = ($cmds -join " && ") + " && echo 'Services started'"
    }
    "stop" {
        $cmds = $services | ForEach-Object { "sudo systemctl stop $_" }
        $sshCmd = ($cmds -join " && ") + " && echo 'Services stopped'"
    }
    "restart" {
        $cmds = $services | ForEach-Object { "sudo systemctl restart $_" }
        $sshCmd = ($cmds -join " && ") + " && echo 'Services restarted'"
    }
    "logs" {
        if ($Follow) {
            $serviceList = $services -join " -u "
            $sshCmd = "sudo journalctl -u $serviceList -f"
        } else {
            $serviceList = $services -join " -u "
            $sshCmd = "sudo journalctl -u $serviceList -n 50 --no-pager"
        }
    }
}

Write-Host "Executing: $Action on $Service service(s)..." -ForegroundColor Yellow

if ($Action -eq "logs" -and $Follow) {
    # For following logs, we need to use ssh directly (plink doesn't support -t well)
    Write-Host "Following logs (Ctrl+C to stop)..." -ForegroundColor Cyan
    & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $sshCmd
} else {
    & plink -i $PpkPath -P $VpsPort -batch "${VpsUser}@${VpsHost}" $sshCmd
}

if ($LASTEXITCODE -ne 0 -and $Action -ne "logs") {
    Write-Host "ERROR: Command failed" -ForegroundColor Red
    exit 1
}
