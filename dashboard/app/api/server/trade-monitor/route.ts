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

async function getPm2Status(): Promise<{ running: boolean; uptime?: number; restarts?: number; memory?: number }> {
  try {
    const { stdout } = await execAsync(STATUS_CMD)
    const processes = JSON.parse(stdout)
    const proc = processes.find((p: any) => p.name === PM2_NAME)
    if (!proc) return { running: false }
    return {
      running: proc.pm2_env?.status === 'online',
      uptime: proc.pm2_env?.pm_uptime ? Date.now() - proc.pm2_env.pm_uptime : undefined,
      restarts: proc.pm2_env?.restart_time,
      memory: proc.monit?.memory,
    }
  } catch {
    return { running: false }
  }
}

// GET — check if trade monitor is running
export async function GET() {
  const status = await getPm2Status()
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
