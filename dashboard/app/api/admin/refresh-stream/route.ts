import { NextRequest } from 'next/server'
import { getServiceSupabase, refreshOneWallet } from '@/lib/refresh-wallet'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes max for Vercel

/**
 * GET /api/admin/refresh-stream
 * Server-Sent Events endpoint for streaming wallet refresh progress.
 * Refreshes all wallets and sends real-time progress events.
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  const supabase = getServiceSupabase()

  // Check if client requested abort
  const abortSignal = request.signal

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Stream closed
        }
      }

      // Fetch all wallet addresses (paginate past Supabase 1000-row default)
      const allWallets: { address: string; username: string | null; balance: number | null }[] = []
      const PAGE_SIZE = 1000
      let offset = 0
      let fetchError: string | null = null

      while (true) {
        const { data, error } = await supabase
          .from('wallets')
          .select('address, username, balance')
          .range(offset, offset + PAGE_SIZE - 1)

        if (error) {
          fetchError = error.message
          break
        }
        if (!data || data.length === 0) break
        allWallets.push(...data)
        if (data.length < PAGE_SIZE) break
        offset += PAGE_SIZE
      }

      if (fetchError || allWallets.length === 0) {
        send({ type: 'error', message: fetchError || 'No wallets found' })
        controller.close()
        return
      }

      const wallets = allWallets

      const total = wallets.length
      send({ type: 'start', total })

      let success = 0
      let failed = 0

      for (let i = 0; i < total; i++) {
        // Check if client disconnected
        if (abortSignal.aborted) {
          send({ type: 'aborted', current: i, total, success, failed })
          controller.close()
          return
        }

        const wallet = wallets[i]
        const result = await refreshOneWallet({
          address: wallet.address,
          username: wallet.username ?? undefined,
          balance: wallet.balance ?? undefined,
        })

        if (result.success) {
          success++
        } else {
          failed++
        }

        send({
          type: 'progress',
          current: i + 1,
          total,
          success,
          failed,
          address: wallet.address,
          username: wallet.username || undefined,
          ok: result.success,
          error: result.error || undefined,
        })
      }

      send({ type: 'done', total, success, failed })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
