'use client'

import { useState, useCallback, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { SimulationResult, DEFAULT_SLIPPAGE_PARAMS } from '@/lib/simulation/types'
import SimulationResults from '@/components/SimulationResults'

type TimePeriodOption = { label: string; days: number }
const TIME_PERIODS: TimePeriodOption[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 365 },
]

type DelayOption = { label: string; seconds: number }
const DELAY_OPTIONS: DelayOption[] = [
  { label: '0s', seconds: 0 },
  { label: '1s', seconds: 1 },
  { label: '2s', seconds: 2 },
  { label: '5s', seconds: 5 },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
]

export default function SimulatePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
      </div>
    }>
      <SimulatePageInner />
    </Suspense>
  )
}

function SimulatePageInner() {
  const searchParams = useSearchParams()
  const initialAddress = searchParams.get('address') || ''

  // Form state
  const [address, setAddress] = useState(initialAddress)
  const [startingCapital, setStartingCapital] = useState(1000)
  const [delaySeconds, setDelaySeconds] = useState(2)
  const [timePeriodDays, setTimePeriodDays] = useState(30)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [baseSpread, setBaseSpread] = useState(DEFAULT_SLIPPAGE_PARAMS.baseSpreadPct)
  const [driftRate, setDriftRate] = useState(DEFAULT_SLIPPAGE_PARAMS.driftPerSecondPct)
  const [sizeImpact, setSizeImpact] = useState(DEFAULT_SLIPPAGE_PARAMS.sizeImpactFactor)
  const [maxSlippage, setMaxSlippage] = useState(DEFAULT_SLIPPAGE_PARAMS.maxSlippagePct)
  const [maxPositionPct, setMaxPositionPct] = useState(20)

  // Simulation state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [loadingMessage, setLoadingMessage] = useState('')

  const resolveAddress = useCallback(async (input: string): Promise<string> => {
    let addr = input.trim()

    // If it's a polymarket URL, extract address
    if (addr.includes('polymarket.com')) {
      const match = addr.match(/0x[a-fA-F0-9]{40}/)
      if (match) return match[0]
      // Try username from URL
      const usernameMatch = addr.match(/polymarket\.com\/@?([^/?]+)/)
      if (usernameMatch) addr = usernameMatch[1]
    }

    // If it looks like a valid address, return it
    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) return addr

    // Try to resolve username
    const cleanUsername = addr.replace(/^@/, '')
    try {
      const res = await fetch(`/api/resolve-username?username=${encodeURIComponent(cleanUsername)}`)
      if (res.ok) {
        const data = await res.json()
        if (data.address) return data.address
      }
    } catch {}

    throw new Error(`Could not resolve "${input}" to a wallet address`)
  }, [])

  const runSimulation = useCallback(async () => {
    if (!address.trim()) {
      setError('Enter a wallet address or username')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setLoadingMessage('Resolving address...')

    try {
      const resolvedAddress = await resolveAddress(address)

      setLoadingMessage('Fetching trades and running simulation...')

      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: resolvedAddress,
          startingCapital,
          delaySeconds,
          timePeriodDays,
          maxPositionPct,
          slippageParams: {
            delaySeconds,
            baseSpreadPct: baseSpread,
            driftPerSecondPct: driftRate,
            sizeImpactFactor: sizeImpact,
            maxSlippagePct: maxSlippage,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Simulation failed')
        return
      }

      setResult(data.result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed')
    } finally {
      setLoading(false)
      setLoadingMessage('')
    }
  }, [address, startingCapital, delaySeconds, timePeriodDays, maxPositionPct, baseSpread, driftRate, sizeImpact, maxSlippage, resolveAddress])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Copy Trading Simulator</h1>
        <p className="text-xs text-gray-500 mt-1">
          Simulate copying a wallet&apos;s trades with execution delay to estimate profitability
        </p>
      </div>

      {/* Config Form */}
      <div className="glass rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Address */}
          <div className="lg:col-span-2">
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
              Wallet Address or Username
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSimulation()}
              placeholder="0x... or username"
              className="w-full bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-purple-500/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Starting Capital */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
              Starting Capital
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                type="number"
                value={startingCapital}
                onChange={(e) => setStartingCapital(Math.max(1, Number(e.target.value)))}
                min={1}
                max={1000000}
                className="w-full bg-white/[0.03] border border-white/10 rounded-lg pl-7 pr-3 py-2 text-sm text-white focus:border-purple-500/50 focus:outline-none transition-colors"
              />
            </div>
          </div>

          {/* Delay */}
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
              Execution Delay
            </label>
            <div className="flex gap-1">
              {DELAY_OPTIONS.map((opt) => (
                <button
                  key={opt.seconds}
                  onClick={() => setDelaySeconds(opt.seconds)}
                  className={`flex-1 px-2 py-2 rounded-lg text-xs font-medium transition-colors ${
                    delaySeconds === opt.seconds
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Time Period + Run Button row */}
        <div className="flex items-end gap-3 mt-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5 block">
              Time Period
            </label>
            <div className="flex gap-1">
              {TIME_PERIODS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setTimePeriodDays(opt.days)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    timePeriodDays === opt.days
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'bg-white/[0.03] text-gray-500 border border-white/5 hover:text-gray-300 hover:bg-white/[0.06]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1" />

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-2 py-2"
          >
            {showAdvanced ? 'Hide' : 'Show'} Advanced
          </button>

          {/* Run Button */}
          <button
            onClick={runSimulation}
            disabled={loading || !address.trim()}
            className="px-6 py-2 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Simulating...
              </span>
            ) : (
              'Run Simulation'
            )}
          </button>
        </div>

        {/* Advanced Parameters */}
        {showAdvanced && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Slippage Model Parameters</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Base Spread %</label>
                <input
                  type="number"
                  step="0.1"
                  value={baseSpread}
                  onChange={(e) => setBaseSpread(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md px-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Drift %/sec</label>
                <input
                  type="number"
                  step="0.01"
                  value={driftRate}
                  onChange={(e) => setDriftRate(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md px-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Size Impact %/$100</label>
                <input
                  type="number"
                  step="0.01"
                  value={sizeImpact}
                  onChange={(e) => setSizeImpact(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md px-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Max Slippage %</label>
                <input
                  type="number"
                  step="0.5"
                  value={maxSlippage}
                  onChange={(e) => setMaxSlippage(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md px-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-gray-600 mb-1 block">Max Position %</label>
                <input
                  type="number"
                  step="1"
                  value={maxPositionPct}
                  onChange={(e) => setMaxPositionPct(Number(e.target.value))}
                  className="w-full bg-white/[0.03] border border-white/5 rounded-md px-2 py-1.5 text-xs text-white focus:border-white/20 focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div className="glass rounded-xl p-8 flex flex-col items-center justify-center gap-3">
          <div className="w-8 h-8 border-2 border-purple-500/30 border-t-purple-500 rounded-full animate-spin" />
          <p className="text-sm text-gray-400">{loadingMessage}</p>
          <p className="text-[10px] text-gray-600">Fetching historical trades and running simulation...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass rounded-xl p-4 border border-red-500/20">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              Simulated {result.tradeCount} trades over {result.config.timePeriodDays}d with {result.config.delaySeconds}s delay
              {result.totalTradesFetched > 0 && ` (${result.totalTradesFetched} total fetched)`}
            </p>
            <p className="text-[10px] text-gray-600">
              Completed in {result.durationMs}ms
            </p>
          </div>
          <SimulationResults result={result} />
        </>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="glass rounded-xl p-12 flex flex-col items-center justify-center gap-3">
          <svg className="w-10 h-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <p className="text-sm text-gray-500">Enter a wallet address and run the simulation</p>
          <p className="text-[10px] text-gray-600 max-w-md text-center">
            The simulator replays historical trades with a configurable execution delay,
            applying a slippage model to estimate how much profit you&apos;d make by copy-trading this wallet.
          </p>
        </div>
      )}
    </div>
  )
}
