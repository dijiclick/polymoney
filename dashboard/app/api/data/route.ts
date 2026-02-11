import { NextResponse } from 'next/server'
import { readdir } from 'fs/promises'
import path from 'path'

const DATA_DIR = path.join(process.cwd(), '..', 'data', 'crypto_ticks')

export async function GET() {
  try {
    const pairs = await readdir(DATA_DIR)
    const files: string[] = []

    for (const pair of pairs) {
      const pairDir = path.join(DATA_DIR, pair)
      const dates = await readdir(pairDir)
      for (const date of dates) {
        if (date.endsWith('.csv')) {
          // Convert ETH_15m/2026-02-07.csv → ETH_15m_2026-02-07.csv
          files.push(`${pair}_${date}`)
        }
      }
    }

    files.sort()
    return NextResponse.json({ files, count: files.length })
  } catch {
    return NextResponse.json({ error: 'Data directory not found' }, { status: 500 })
  }
}
