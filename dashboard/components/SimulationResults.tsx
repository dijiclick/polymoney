'use client'

import { useState, useMemo, useRef, useCallback } from 'react'
import { SimulationResult, EquityCurvePoint } from '@/lib/simulation/types'

// ============================================
// Utility formatters
// ============================================

function formatMoney(v: number) {
  const sign = v >= 0 ? '+' : ''
  const abs = Math.abs(v)
  if (abs >= 1000000) return `${sign}$${(v / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `${sign}$${(v / 1000).toFixed(1)}K`
  return `${sign}$${v.toFixed(0)}`
}

function formatMoneyPlain(v: number) {
  const abs = Math.abs(v)
  if (abs >= 1000000) return `$${(v / 1000000).toFixed(2)}M`
  if (abs >= 1000) return `$${(v / 1000).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function formatPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
}

function formatPctPlain(v: number) {
  return `${v.toFixed(1)}%`
}

function pnlColor(v: number) {
  if (v > 0) return 'text-emerald-400'
  if (v < 0) return 'text-red-400'
  return 'text-gray-400'
}

// ============================================
// Summary Cards
// ============================================

function SummaryCards({ result }: { result: SimulationResult }) {
  const cards = [
    {
      label: 'Simulated ROI',
      value: formatPct(result.totalRoi),
      color: pnlColor(result.totalRoi),
      sub: `Original: ${formatPct(result.originalRoi)}`,
    },
    {
      label: 'Simulated P&L',
      value: formatMoney(result.totalPnl),
      color: pnlColor(result.totalPnl),
      sub: `Original: ${formatMoney(result.originalPnl)}`,
    },
    {
      label: 'Final Capital',
      value: formatMoneyPlain(result.finalCapital),
      color: pnlColor(result.totalPnl),
      sub: `Started: ${formatMoneyPlain(result.config.startingCapital)}`,
    },
    {
      label: 'Win Rate',
      value: formatPctPlain(result.winRate),
      color: result.winRate >= 50 ? 'text-emerald-400' : 'text-red-400',
      sub: `Original: ${formatPctPlain(result.originalWinRate)}`,
    },
    {
      label: 'Max Drawdown',
      value: formatPctPlain(result.maxDrawdown),
      color: result.maxDrawdown <= 10 ? 'text-emerald-400' : result.maxDrawdown <= 25 ? 'text-amber-400' : 'text-red-400',
      sub: `${result.winCount}W / ${result.lossCount}L`,
    },
    {
      label: 'Trades',
      value: `${result.tradeCount}`,
      color: 'text-white',
      sub: `${result.skippedTrades} skipped · ${result.avgSlippage.toFixed(2)}% avg slip`,
    },
  ]

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {cards.map((card) => (
        <div key={card.label} className="glass rounded-xl p-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">{card.label}</p>
          <p className={`text-lg font-semibold tabular-nums ${card.color}`}>{card.value}</p>
          <p className="text-[10px] text-gray-500 mt-0.5">{card.sub}</p>
        </div>
      ))}
    </div>
  )
}

// ============================================
// Equity Curve Chart (dual line: simulated vs original)
// ============================================

function EquityCurveChart({ result }: { result: SimulationResult }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const hoverRef = useRef<number | null>(null)

  const W = 800
  const H = 220
  const PX = 32
  const PR = 56
  const PY = 16

  const chartData = useMemo(() => {
    let curve = result.equityCurve
    if (curve.length < 2) return null

    // Downsample to max 500 points for SVG performance
    if (curve.length > 500) {
      const step = Math.ceil(curve.length / 500)
      const sampled: EquityCurvePoint[] = [curve[0]]
      for (let i = step; i < curve.length - 1; i += step) {
        sampled.push(curve[i])
      }
      sampled.push(curve[curve.length - 1])
      curve = sampled
    }

    // Simulated capital values
    const simValues = curve.map(p => p.simulatedCapital)
    // Original cumulative P&L (shifted to start from same starting capital)
    const origValues = curve.map(p => result.config.startingCapital + p.originalCumPnl)

    const allValues = [...simValues, ...origValues]
    const min = Math.min(...allValues)
    const max = Math.max(...allValues)
    const range = max - min || 1

    const tMin = curve[0].timestamp
    const tMax = curve[curve.length - 1].timestamp
    const tRange = tMax - tMin || 1

    const xs = curve.map(p => PX + ((p.timestamp - tMin) / tRange) * (W - PX - PR))

    const simYs = simValues.map(v => PY + (1 - (v - min) / range) * (H - 2 * PY))
    const origYs = origValues.map(v => PY + (1 - (v - min) / range) * (H - 2 * PY))

    const simPath = `M${xs.map((x, i) => `${x.toFixed(1)},${simYs[i].toFixed(1)}`).join('L')}`
    const origPath = `M${xs.map((x, i) => `${x.toFixed(1)},${origYs[i].toFixed(1)}`).join('L')}`

    // Fill area under simulated line
    const simAreaPath = `${simPath}L${xs[xs.length - 1].toFixed(1)},${H}L${xs[0].toFixed(1)},${H}Z`

    const zeroY = PY + (1 - (result.config.startingCapital - min) / range) * (H - 2 * PY)

    // Y-axis ticks
    const TICK_COUNT = 5
    const ticks: { y: number; label: string }[] = []
    for (let i = 0; i < TICK_COUNT; i++) {
      const val = max - (range * i) / (TICK_COUNT - 1)
      const y = PY + (1 - (val - min) / range) * (H - 2 * PY)
      ticks.push({ y, label: formatMoneyPlain(val) })
    }

    // X-axis ticks
    const xTickCount = Math.min(6, curve.length)
    const xTicks: { pct: number; label: string }[] = []
    for (let i = 0; i < xTickCount; i++) {
      const t = tMin + (tRange * i) / (xTickCount - 1)
      const pctInner = (t - tMin) / tRange
      const pxFromLeft = PX + pctInner * (W - PX - PR)
      const pct = (pxFromLeft / W) * 100
      const d = new Date(t * 1000)
      xTicks.push({
        pct,
        label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }

    return { xs, simYs, origYs, simPath, origPath, simAreaPath, zeroY, ticks, xTicks, min, max, simValues, origValues }
  }, [result])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || !chartData) return
    const rect = svgRef.current.getBoundingClientRect()
    const mouseX = (e.clientX - rect.left) / rect.width * W

    let nearest = 0
    let nearestDist = Infinity
    for (let i = 0; i < chartData.xs.length; i++) {
      const dist = Math.abs(chartData.xs[i] - mouseX)
      if (dist < nearestDist) {
        nearestDist = dist
        nearest = i
      }
    }

    if (hoverRef.current !== nearest) {
      hoverRef.current = nearest
      setHoverIndex(nearest)
    }
  }, [chartData])

  const handleMouseLeave = useCallback(() => {
    hoverRef.current = null
    setHoverIndex(null)
  }, [])

  if (!chartData) {
    return (
      <div className="glass rounded-xl p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Equity Curve</p>
        <div className="flex items-center justify-center" style={{ height: 220 }}>
          <p className="text-xs text-gray-600">Not enough data points for chart</p>
        </div>
      </div>
    )
  }

  const hoverInfo = hoverIndex !== null ? {
    simValue: chartData.simValues[hoverIndex],
    origValue: chartData.origValues[hoverIndex],
    date: new Date(result.equityCurve[hoverIndex].timestamp * 1000),
  } : null

  const lastSim = chartData.simValues[chartData.simValues.length - 1]
  const isPositive = lastSim >= result.config.startingCapital

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-0.5">Equity Curve</p>
          {hoverInfo ? (
            <>
              <div className="flex items-center gap-3">
                <p className={`text-lg font-semibold tabular-nums ${pnlColor(hoverInfo.simValue - result.config.startingCapital)}`}>
                  {formatMoneyPlain(hoverInfo.simValue)}
                  <span className="text-[10px] text-gray-500 ml-1">sim</span>
                </p>
                <p className="text-sm text-gray-400 tabular-nums">
                  {formatMoneyPlain(hoverInfo.origValue)}
                  <span className="text-[10px] text-gray-500 ml-1">orig</span>
                </p>
              </div>
              <p className="text-[10px] text-gray-500 tabular-nums mt-0.5">
                {hoverInfo.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            </>
          ) : (
            <p className={`text-lg font-semibold tabular-nums ${pnlColor(result.totalPnl)}`}>
              {formatMoneyPlain(result.finalCapital)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-emerald-400 inline-block" />
            <span className="text-gray-500">Simulated</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded bg-blue-400 inline-block" style={{ opacity: 0.5 }} />
            <span className="text-gray-500">Original</span>
          </span>
        </div>
      </div>

      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="w-full cursor-crosshair"
          style={{ height: 220 }}
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="simGradGreen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="simGradRed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f87171" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Starting capital reference line */}
          <line
            x1={PX} y1={chartData.zeroY} x2={W - PR} y2={chartData.zeroY}
            stroke="white" strokeOpacity="0.06" strokeDasharray="4,4"
            vectorEffect="non-scaling-stroke"
          />

          {/* Simulated fill */}
          <path
            d={chartData.simAreaPath}
            fill={isPositive ? 'url(#simGradGreen)' : 'url(#simGradRed)'}
          />

          {/* Original line (dashed, behind) */}
          <path
            d={chartData.origPath}
            fill="none"
            stroke="#60a5fa"
            strokeWidth="1.5"
            strokeOpacity="0.4"
            strokeDasharray="4,3"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Simulated line (solid, front) */}
          <path
            d={chartData.simPath}
            fill="none"
            stroke={isPositive ? '#34d399' : '#f87171'}
            strokeWidth="1.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* Hover crosshair */}
          {hoverIndex !== null && chartData.xs[hoverIndex] !== undefined && (
            <>
              <line
                x1={chartData.xs[hoverIndex]} y1={0}
                x2={chartData.xs[hoverIndex]} y2={H}
                stroke="white" strokeOpacity="0.12" strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
              {/* Simulated dot */}
              <circle
                cx={chartData.xs[hoverIndex]}
                cy={chartData.simYs[hoverIndex]}
                r="4"
                fill={isPositive ? '#34d399' : '#f87171'}
                stroke="#0d0d12" strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
              {/* Original dot */}
              <circle
                cx={chartData.xs[hoverIndex]}
                cy={chartData.origYs[hoverIndex]}
                r="3"
                fill="#60a5fa"
                fillOpacity="0.6"
                stroke="#0d0d12" strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {/* Y-axis labels */}
        {chartData.ticks.map((tick, i) => (
          <span
            key={i}
            className="absolute right-1 text-[9px] text-gray-500 tabular-nums font-mono pointer-events-none"
            style={{ top: `${(tick.y / H) * 100}%`, transform: 'translateY(-50%)' }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* X-axis labels */}
      {chartData.xTicks.length > 0 && (
        <div className="relative h-4 mt-1">
          {chartData.xTicks.map((tick, i) => (
            <span
              key={i}
              className="absolute text-[9px] text-gray-600 tabular-nums -translate-x-1/2"
              style={{ left: `${tick.pct}%` }}
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// Trade Breakdown Table
// ============================================

function TradeBreakdownTable({ result }: { result: SimulationResult }) {
  const [showSkipped, setShowSkipped] = useState(false)

  const filteredTrades = useMemo(() => {
    if (showSkipped) return result.trades
    return result.trades.filter(t => !t.skipped)
  }, [result.trades, showSkipped])

  // Show most recent first
  const sortedTrades = useMemo(() =>
    [...filteredTrades].sort((a, b) => b.timestamp - a.timestamp),
    [filteredTrades]
  )

  return (
    <div className="glass rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider">Trade Breakdown</p>
        <label className="flex items-center gap-1.5 text-[10px] text-gray-500 cursor-pointer">
          <input
            type="checkbox"
            checked={showSkipped}
            onChange={(e) => setShowSkipped(e.target.checked)}
            className="rounded bg-white/5 border-white/10 text-purple-500 focus:ring-0 focus:ring-offset-0"
          />
          Show skipped ({result.skippedTrades})
        </label>
      </div>

      <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-500 text-left">
              <th className="pb-2 pr-3 font-medium">Time</th>
              <th className="pb-2 pr-3 font-medium">Market</th>
              <th className="pb-2 pr-3 font-medium">Side</th>
              <th className="pb-2 pr-3 font-medium text-right">Orig Price</th>
              <th className="pb-2 pr-3 font-medium text-right">Sim Price</th>
              <th className="pb-2 pr-3 font-medium text-right">Slippage</th>
              <th className="pb-2 pr-3 font-medium text-right">Size</th>
              <th className="pb-2 font-medium text-right">Capital</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrades.slice(0, 200).map((trade, i) => (
              <tr
                key={i}
                className={`border-t border-white/[0.03] ${trade.skipped ? 'opacity-40' : ''}`}
              >
                <td className="py-1.5 pr-3 text-gray-400 tabular-nums whitespace-nowrap">
                  {new Date(trade.timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td className="py-1.5 pr-3 text-gray-300 max-w-[180px] truncate" title={trade.market}>
                  {trade.market}
                </td>
                <td className="py-1.5 pr-3">
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                    trade.side === 'BUY'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>
                    {trade.side}
                  </span>
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-400">
                  ${trade.originalPrice.toFixed(2)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-white">
                  {trade.skipped ? '-' : `$${trade.adjustedPrice.toFixed(2)}`}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-amber-400">
                  {trade.skipped
                    ? <span className="text-red-400 text-[9px]" title={trade.skipReason}>skip</span>
                    : `${trade.slippagePct.toFixed(2)}%`
                  }
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-300">
                  {trade.skipped ? '-' : `$${trade.simulatedUsdValue.toFixed(0)}`}
                </td>
                <td className="py-1.5 text-right tabular-nums text-gray-400">
                  ${trade.capitalAfter.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sortedTrades.length > 200 && (
          <p className="text-[10px] text-gray-600 mt-2">Showing first 200 of {sortedTrades.length} trades</p>
        )}
      </div>
    </div>
  )
}

// ============================================
// Positions Table
// ============================================

function PositionsTable({ result }: { result: SimulationResult }) {
  const resolved = result.positions.filter(p => p.resolved)
  const open = result.positions.filter(p => !p.resolved)

  if (resolved.length === 0 && open.length === 0) return null

  return (
    <div className="glass rounded-xl p-4">
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-3">
        Positions ({resolved.length} resolved, {open.length} open)
      </p>

      <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-gray-500 text-left">
              <th className="pb-2 pr-3 font-medium">Market</th>
              <th className="pb-2 pr-3 font-medium">Outcome</th>
              <th className="pb-2 pr-3 font-medium text-right">Entry</th>
              <th className="pb-2 pr-3 font-medium text-right">Orig Entry</th>
              <th className="pb-2 pr-3 font-medium text-right">Invested</th>
              <th className="pb-2 pr-3 font-medium text-right">Sim P&L</th>
              <th className="pb-2 font-medium text-right">Orig P&L</th>
            </tr>
          </thead>
          <tbody>
            {resolved.sort((a, b) => Math.abs(b.realizedPnl) - Math.abs(a.realizedPnl)).slice(0, 100).map((pos, i) => (
              <tr key={i} className="border-t border-white/[0.03]">
                <td className="py-1.5 pr-3 text-gray-300 max-w-[200px] truncate" title={pos.market}>
                  {pos.market}
                </td>
                <td className="py-1.5 pr-3 text-gray-400">{pos.outcome}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-white">
                  ${pos.avgEntryPrice.toFixed(2)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-400">
                  ${pos.originalAvgEntryPrice.toFixed(2)}
                </td>
                <td className="py-1.5 pr-3 text-right tabular-nums text-gray-300">
                  ${pos.totalInvested.toFixed(0)}
                </td>
                <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${pnlColor(pos.realizedPnl)}`}>
                  {formatMoney(pos.realizedPnl)}
                </td>
                <td className={`py-1.5 text-right tabular-nums ${pnlColor(pos.originalRealizedPnl)}`}>
                  {formatMoney(pos.originalRealizedPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================
// Main Export
// ============================================

export default function SimulationResults({ result }: { result: SimulationResult }) {
  return (
    <div className="space-y-3">
      <SummaryCards result={result} />
      <EquityCurveChart result={result} />
      <TradeBreakdownTable result={result} />
      <PositionsTable result={result} />
    </div>
  )
}
