'use client'

interface Wallet {
  total_pnl: number
  total_roi: number
  win_rate: number
  open_trade_count: number
  closed_trade_count: number
  total_volume_bought: number
  total_volume_sold: number
  avg_hold_duration_hours: number | null
}

interface Props {
  wallet: Wallet
}

function formatMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(2)}`
}

function formatDuration(hours: number | null): string {
  if (hours === null || hours === undefined) return '-'
  if (hours < 1) return `${Math.round(hours * 60)}m`
  if (hours < 24) return `${hours.toFixed(1)}h`
  const days = hours / 24
  if (days < 30) return `${days.toFixed(1)}d`
  return `${(days / 30).toFixed(1)}mo`
}

const METRICS: {
  label: string
  getValue: (w: Wallet) => string
  getColor: (w: Wallet) => string
  getBg: (w: Wallet) => string
}[] = [
  {
    label: 'Total PnL',
    getValue: (w) => formatMoney(w.total_pnl),
    getColor: (w) => w.total_pnl >= 0 ? 'text-emerald-400' : 'text-red-400',
    getBg: (w) => w.total_pnl > 0 ? 'bg-emerald-500/5' : w.total_pnl < 0 ? 'bg-red-500/5' : 'bg-white/[0.03]',
  },
  {
    label: 'ROI',
    getValue: (w) => `${w.total_roi >= 0 ? '+' : ''}${w.total_roi.toFixed(1)}%`,
    getColor: (w) => w.total_roi >= 0 ? 'text-emerald-400' : 'text-red-400',
    getBg: (w) => w.total_roi > 0 ? 'bg-emerald-500/5' : w.total_roi < 0 ? 'bg-red-500/5' : 'bg-white/[0.03]',
  },
  {
    label: 'Win Rate',
    getValue: (w) => `${w.win_rate.toFixed(1)}%`,
    getColor: (w) => w.win_rate >= 60 ? 'text-emerald-400' : w.win_rate >= 50 ? 'text-amber-400' : 'text-red-400',
    getBg: (w) => w.win_rate >= 60 ? 'bg-emerald-500/5' : w.win_rate >= 50 ? 'bg-amber-500/5' : 'bg-red-500/5',
  },
  {
    label: 'Volume In',
    getValue: (w) => formatMoney(w.total_volume_bought),
    getColor: () => 'text-white',
    getBg: () => 'bg-white/[0.03]',
  },
  {
    label: 'Open Trades',
    getValue: (w) => String(w.open_trade_count),
    getColor: () => 'text-blue-400',
    getBg: () => 'bg-blue-500/5',
  },
  {
    label: 'Closed Trades',
    getValue: (w) => String(w.closed_trade_count),
    getColor: () => 'text-gray-300',
    getBg: () => 'bg-white/[0.03]',
  },
  {
    label: 'Avg Hold',
    getValue: (w) => formatDuration(w.avg_hold_duration_hours),
    getColor: () => 'text-gray-300',
    getBg: () => 'bg-white/[0.03]',
  },
  {
    label: 'Volume Out',
    getValue: (w) => formatMoney(w.total_volume_sold),
    getColor: () => 'text-gray-300',
    getBg: () => 'bg-white/[0.03]',
  },
]

export default function NewMetricsGrid({ wallet }: Props) {
  return (
    <div className="grid grid-cols-4 gap-2 p-4">
      {METRICS.map(m => (
        <div key={m.label} className={`rounded-lg px-3 py-2.5 border border-white/[0.04] ${m.getBg(wallet)}`}>
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{m.label}</div>
          <div className={`text-sm font-mono font-semibold tabular-nums ${m.getColor(wallet)}`}>
            {m.getValue(wallet)}
          </div>
        </div>
      ))}
    </div>
  )
}
