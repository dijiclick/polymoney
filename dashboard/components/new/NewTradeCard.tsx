'use client'

interface Trade {
  id: number
  condition_id: string
  market_title: string | null
  market_slug: string | null
  primary_outcome: string | null
  closed: boolean
  open_timestamp: string
  close_timestamp: string | null
  number_of_buys: number
  number_of_sells: number
  total_volume_bought: number
  total_volume_sold: number
  roi: number
  pnl: number
}

interface Props {
  trade: Trade
}

function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatDurationBetween(open: string, close: string | null): string {
  if (!close) return 'ongoing'
  const ms = new Date(close).getTime() - new Date(open).getTime()
  const hours = ms / (1000 * 60 * 60)
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = hours / 24
  if (days < 30) return `${days.toFixed(1)}d`
  return `${(days / 30).toFixed(1)}mo`
}

export default function NewTradeCard({ trade }: Props) {
  const pnlColor = trade.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
  const roiColor = trade.roi >= 0 ? 'text-emerald-400' : 'text-red-400'
  const statusColor = trade.closed
    ? (trade.pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400')
    : 'bg-blue-500/10 text-blue-400'

  return (
    <div className="px-4 py-3 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor}`}>
              {trade.closed ? (trade.pnl >= 0 ? 'WIN' : 'LOSS') : 'OPEN'}
            </span>
            <h4 className="text-sm font-medium text-white truncate">
              {trade.market_title || trade.condition_id.slice(0, 12) + '...'}
            </h4>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-300">
              {trade.primary_outcome || 'Yes'}
            </span>
            <span>{trade.number_of_buys} buys</span>
            <span>{trade.number_of_sells} sells</span>
            <span className="text-gray-500">|</span>
            <span>{formatMoney(trade.total_volume_bought)} in</span>
            <span>{formatMoney(trade.total_volume_sold)} out</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            <span>Opened {formatDate(trade.open_timestamp)}</span>
            {trade.close_timestamp && (
              <>
                <span>Closed {formatDate(trade.close_timestamp)}</span>
                <span>({formatDurationBetween(trade.open_timestamp, trade.close_timestamp)})</span>
              </>
            )}
            {!trade.close_timestamp && <span>(ongoing)</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-sm font-mono font-medium ${pnlColor}`}>
            {trade.pnl >= 0 ? '+' : ''}{formatMoney(trade.pnl)}
          </div>
          <div className={`text-xs font-mono ${roiColor}`}>
            {trade.roi >= 0 ? '+' : ''}{trade.roi.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  )
}
