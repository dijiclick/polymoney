import { NextRequest, NextResponse } from 'next/server'
import { readFile, readdir } from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), '..', 'data', 'crypto_ticks')

// Whitelist of valid symbols and intervals
const VALID_SYMBOLS = ['BTC', 'ETH', 'SOL', 'XRP']
const VALID_INTERVALS = ['15m', '1h', '4h']

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params

  // Expect format: ETH_15m_2026-02-07.csv
  const match = filename.match(/^([A-Z]+)_(\d+[mhd])_(\d{4}-\d{2}-\d{2})\.csv$/)
  if (!match) {
    return NextResponse.json(
      { error: 'Invalid filename format. Expected: SYMBOL_INTERVAL_YYYY-MM-DD.csv' },
      { status: 400 }
    )
  }

  const [, symbol, interval, date] = match

  if (!VALID_SYMBOLS.includes(symbol) || !VALID_INTERVALS.includes(interval)) {
    return NextResponse.json(
      { error: `Invalid symbol or interval. Valid: ${VALID_SYMBOLS.join(',')} × ${VALID_INTERVALS.join(',')}` },
      { status: 400 }
    )
  }

  // Validate date format to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
  }

  const filePath = path.join(DATA_DIR, `${symbol}_${interval}`, `${date}.csv`)

  // Ensure resolved path stays within DATA_DIR
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(DATA_DIR))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const content = await readFile(filePath, 'utf-8')
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
