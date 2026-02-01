import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const dynamic = 'force-dynamic'

const PM2_NAME = 'trade-monitor'
const START_CMD = `cd /opt/polymarket && pm2 start "python3 -m src.realtime.service" --name ${PM2_NAME} --cwd /opt/polymarket`
const STOP_CMD = `pm2 stop ${PM2_NAME}`
const DELETE_CMD = `pm2 delete ${PM2_NAME}`
const STATUS_CMD = `pm2 jlist`

interface Pm2Status {
  running: boolean
  status?: string
  uptime?: number
  restarts?: number
  memory?: number
}

async function getPm2Status(): Promise<Pm2Status> {
  try {
    const { stdout } = await execAsync(STATUS_CMD)
    const processes = JSON.parse(stdout)
    const proc = processes.find((p: any) => p.name === PM2_NAME)
    if (!proc) return { running: false }
    const pm2Status = proc.pm2_env?.status
    return {
      running: pm2Status === 'online',
      status: pm2Status,
      uptime: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : undefined,
      restarts: proc.pm2_env?.restart_time,
      memory: proc.monit?.memory,
    }
  } catch {
    return { running: false }
  }
}

async function getPm2Logs(lines: number = 40): Promise<string> {
  try {
    // Flush logs first, then read last N lines (combined stdout + stderr)
    const { stdout } = await execAsync(
      `pm2 logs ${PM2_NAME} --nostream --lines ${lines} 2>&1`,
      { timeout: 5000 }
    )
    return stdout.trim()
  } catch {
    return ''
  }
}

// GET — check if trade monitor is running, optionally include logs
export async function GET(request: NextRequest) {
  const withLogs = request.nextUrl.searchParams.get('logs') === '1'
  const logLines = parseInt(request.nextUrl.searchParams.get('lines') || '40', 10)

  const status = await getPm2Status()

  if (withLogs) {
    const logs = await getPm2Logs(Math.min(logLines, 200))
    return NextResponse.json({ ...status, logs })
  }

  return NextResponse.json(status)
}

// POST — start or stop trade monitor
export async function POST(request: NextRequest) {
  const { action } = await request.json()

  if (action === 'start') {
    // Delete stale process if exists, then start fresh
    try { await execAsync(DELETE_CMD) } catch { /* ignore if not found */ }
    try {
      await execAsync(START_CMD)
      await execAsync('pm2 save')
      // Wait a moment for process to start
      await new Promise(r => setTimeout(r, 1500))
      const status = await getPm2Status()
      return NextResponse.json({ ok: true, ...status })
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
    }
  }

  if (action === 'stop') {
    try {
      await execAsync(STOP_CMD)
      await execAsync(DELETE_CMD)
      await execAsync('pm2 save')
      return NextResponse.json({ ok: true, running: false })
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Invalid action. Use "start" or "stop".' }, { status: 400 })
}
