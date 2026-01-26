"""
Wallet discovery processor for live trade monitoring.

Discovers new wallets from live trades >= $50 and fetches their trade history.
Uses Polymarket Data API for all metrics calculation.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from supabase import Client

from ..scrapers.data_api import PolymarketDataAPI

logger = logging.getLogger(__name__)


class WalletDiscoveryProcessor:
    """
    Async processor that discovers new wallets from live trades.

    When a trade >= $50 comes in from an unknown wallet:
    1. Queue the wallet for processing
    2. Fetch portfolio value and positions from Polymarket API
    3. Calculate 7d and 30d metrics (PnL, ROI, win rate, etc.)
    4. Store wallet with metrics in database
    """

    # Processing settings - Conservative (40% of API rate limits)
    NUM_WORKERS = 5  # Process 5 wallets concurrently
    REQUEST_INTERVAL = 0.3  # 300ms between requests per worker (~3 req/s per worker)

    MAX_QUEUE_SIZE = 5000
    HISTORY_DAYS = 30
    REANALYSIS_COOLDOWN_DAYS = 1  # Re-analyze daily for fresh data

    def __init__(self, supabase: Client):
        """
        Initialize the wallet discovery processor.

        Args:
            supabase: Supabase client instance
        """
        self.supabase = supabase
        self._api: Optional[PolymarketDataAPI] = None

        # In-memory caches for O(1) lookup
        self._known_wallets: set[str] = set()
        self._wallet_last_analyzed: dict[str, datetime] = {}
        self._pending_wallets: set[str] = set()

        # Processing queue
        self._queue: asyncio.Queue[tuple[str, float]] = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)

        # Per-worker rate limiting
        self._worker_last_request: dict[int, datetime] = {}

        # Stats
        self._wallets_discovered = 0
        self._wallets_skipped_cooldown = 0
        self._wallets_processed = 0
        self._trades_stored = 0
        self._errors = 0

    async def initialize(self) -> None:
        """Load existing wallet addresses and last analysis times into memory cache."""
        try:
            logger.info("Loading wallet addresses into cache...")
            result = self.supabase.table("wallets").select("address, metrics_updated_at").execute()

            self._known_wallets = set()
            self._wallet_last_analyzed = {}

            for w in result.data or []:
                addr = w["address"].lower()
                self._known_wallets.add(addr)

                if w.get("metrics_updated_at"):
                    try:
                        last_analyzed = datetime.fromisoformat(
                            str(w["metrics_updated_at"]).replace("Z", "+00:00")
                        )
                        self._wallet_last_analyzed[addr] = last_analyzed
                    except Exception:
                        pass

            logger.info(f"Loaded {len(self._known_wallets)} wallet addresses into cache")

            # Initialize Polymarket API
            self._api = PolymarketDataAPI()
            await self._api.__aenter__()
            logger.info("Polymarket API initialized for metrics calculation")

        except Exception as e:
            logger.error(f"Failed to initialize wallet discovery: {e}")
            self._errors += 1

    async def shutdown(self) -> None:
        """Clean up resources."""
        if self._api:
            await self._api.__aexit__(None, None, None)

    async def check_and_queue(self, trader_address: str, usd_value: float) -> bool:
        """
        Check if wallet needs analysis and queue for processing.

        Wallets are analyzed if:
        1. Never seen before, OR
        2. Last analyzed more than REANALYSIS_COOLDOWN_DAYS ago

        Args:
            trader_address: The wallet address
            usd_value: The trade value in USD

        Returns:
            True if wallet was queued, False if skipped or queue full
        """
        addr = trader_address.lower()

        self._wallets_discovered += 1

        if addr in self._pending_wallets:
            return False

        if addr in self._known_wallets:
            last_analyzed = self._wallet_last_analyzed.get(addr)
            if last_analyzed:
                now = datetime.now(timezone.utc)
                days_since = (now - last_analyzed).days
                if days_since < self.REANALYSIS_COOLDOWN_DAYS:
                    self._wallets_skipped_cooldown += 1
                    return False

            logger.debug(f"Wallet {addr[:10]}... needs re-analysis")

        try:
            self._queue.put_nowait((addr, usd_value))
            self._pending_wallets.add(addr)
            is_new = addr not in self._known_wallets
            logger.info(
                f"{'New' if is_new else 'Re-analyzing'} wallet: {addr[:10]}... "
                f"(${usd_value:,.0f} trade)"
            )
            return True

        except asyncio.QueueFull:
            if usd_value >= 1000:
                logger.warning(f"Queue full, but high-value trade (${usd_value:,.0f}) - wallet will be processed later")
            return False

    async def process_queue(self, worker_id: int = 0) -> None:
        """Background task to process discovery queue."""
        logger.info(f"Starting wallet discovery worker {worker_id}")
        self._worker_last_request[worker_id] = datetime.now(timezone.utc)

        while True:
            try:
                addr, usd_value = await self._queue.get()

                try:
                    await self._rate_limit_wait(worker_id)
                    await self._process_wallet(addr)

                except Exception as e:
                    logger.error(f"Error processing wallet {addr[:10]}...: {e}")
                    self._errors += 1

                finally:
                    self._pending_wallets.discard(addr)
                    self._queue.task_done()

            except asyncio.CancelledError:
                logger.info(f"Wallet discovery worker {worker_id} stopped")
                break

            except Exception as e:
                logger.error(f"Unexpected error in discovery worker {worker_id}: {e}")
                self._errors += 1
                await asyncio.sleep(1)

    async def _rate_limit_wait(self, worker_id: int) -> None:
        """Wait to respect rate limits for a specific worker."""
        now = datetime.now(timezone.utc)
        last_request = self._worker_last_request.get(worker_id, now)
        elapsed = (now - last_request).total_seconds()

        if elapsed < self.REQUEST_INTERVAL:
            wait_time = self.REQUEST_INTERVAL - elapsed
            await asyncio.sleep(wait_time)

        self._worker_last_request[worker_id] = datetime.now(timezone.utc)

    async def _process_wallet(self, address: str) -> None:
        """
        Process a single wallet: fetch data, calculate metrics, store.

        Args:
            address: The wallet address to process
        """
        if not self._api:
            raise RuntimeError("Polymarket API client not initialized")

        logger.debug(f"Processing wallet: {address[:10]}...")

        # Fetch data in parallel from Polymarket API
        api_tasks = [
            self._api.get_positions(address),
            self._api.get_closed_positions(address),
            self._api.get_total_balance(address),
            self._api.get_profile(address),
        ]

        results = await asyncio.gather(*api_tasks, return_exceptions=True)

        positions = results[0] if not isinstance(results[0], Exception) else []
        closed_positions = results[1] if not isinstance(results[1], Exception) else []
        if not isinstance(results[2], Exception):
            portfolio_value, _, usdc_cash = results[2]
        else:
            portfolio_value, usdc_cash = 0, 0
        profile = results[3] if not isinstance(results[3], Exception) else {}

        if not positions and not closed_positions:
            logger.debug(f"No positions found for {address[:10]}...")
            return

        # Calculate all metrics using our formulas
        metrics = self._calculate_metrics(
            positions=positions,
            closed_positions=closed_positions,
            current_balance=portfolio_value
        )

        # Calculate period metrics (7d, 30d)
        metrics_7d = self._calculate_period_metrics(closed_positions, 7, portfolio_value)
        metrics_30d = self._calculate_period_metrics(closed_positions, 30, portfolio_value)

        logger.debug(
            f"Positions={metrics.get('closed_count', 0)}, "
            f"win_rate={metrics.get('win_rate_all', 0):.1f}%"
        )

        wallet_data = {
            "address": address,
            "source": "live",
            "balance": portfolio_value,
            "balance_updated_at": datetime.now(timezone.utc).isoformat(),
            "username": profile.get("name") or profile.get("pseudonym"),
            "account_created_at": profile.get("createdAt"),
            # 7-day metrics
            "pnl_7d": metrics_7d["pnl"],
            "roi_7d": metrics_7d["roi"],
            "win_rate_7d": metrics_7d["win_rate"],
            "volume_7d": metrics_7d["volume"],
            "trade_count_7d": metrics_7d["trade_count"],
            "drawdown_7d": metrics_7d["drawdown"],
            # 30-day metrics
            "pnl_30d": metrics_30d["pnl"],
            "roi_30d": metrics_30d["roi"],
            "win_rate_30d": metrics_30d["win_rate"],
            "volume_30d": metrics_30d["volume"],
            "trade_count_30d": metrics_30d["trade_count"],
            "drawdown_30d": metrics_30d["drawdown"],
            # Overall metrics
            "total_positions": metrics.get("closed_count", 0),
            "active_positions": metrics.get("open_count", 0),
            "total_wins": metrics.get("win_count", 0),
            "total_losses": metrics.get("loss_count", 0),
            "realized_pnl": metrics.get("realized_pnl", 0),
            "unrealized_pnl": metrics.get("unrealized_pnl", 0),
            "overall_pnl": metrics.get("total_pnl", 0),
            "overall_roi": metrics.get("roi_all", 0),
            "overall_win_rate": metrics.get("win_rate_all", 0),
            "total_volume": metrics.get("total_bought", 0),
            "total_trades": metrics.get("trade_count", 0),
            "metrics_updated_at": datetime.now(timezone.utc).isoformat(),
        }

        self.supabase.table("wallets").upsert(
            wallet_data, on_conflict="address"
        ).execute()

        # Update caches
        now = datetime.now(timezone.utc)
        self._known_wallets.add(address)
        self._wallet_last_analyzed[address] = now

        self._wallets_processed += 1

        logger.info(
            f"Wallet processed: {address[:10]}... | "
            f"balance=${portfolio_value:,.0f} | "
            f"positions={metrics.get('closed_count', 0)} | "
            f"win_rate={metrics.get('win_rate_all', 0):.1f}% | "
            f"pnl=${metrics.get('realized_pnl', 0):,.0f}"
        )

    def _parse_positions(self, positions: list[dict]) -> dict:
        """Parse open positions."""
        if not positions:
            return {"count": 0, "total_value": 0, "unrealized_pnl": 0}

        total_value = 0
        unrealized_pnl = 0

        for pos in positions:
            total_value += float(pos.get("currentValue", 0))
            unrealized_pnl += float(pos.get("cashPnl", 0))

        return {
            "count": len(positions),
            "total_value": total_value,
            "unrealized_pnl": unrealized_pnl
        }

    def _parse_closed_positions(self, closed_positions: list[dict]) -> dict:
        """Parse closed positions."""
        if not closed_positions:
            return {"count": 0, "realized_pnl": 0, "wins": 0, "losses": 0}

        realized_pnl = 0
        wins = 0
        losses = 0

        for pos in closed_positions:
            pnl = float(pos.get("realizedPnl", 0))
            realized_pnl += pnl
            if pnl > 0:
                wins += 1
            else:
                losses += 1

        return {
            "count": len(closed_positions),
            "realized_pnl": realized_pnl,
            "wins": wins,
            "losses": losses
        }

    def _group_into_trades(
        self,
        closed_positions: list[dict],
        open_positions: list[dict]
    ) -> list[dict]:
        """
        Group positions into trades.
        - Same conditionId + different outcomes (hedging) = 1 trade
        - Same conditionId + same outcome (re-entry) = separate trades
        """
        market_groups: dict[str, dict] = {}

        # Process closed positions
        for pos in closed_positions:
            condition_id = pos.get("conditionId", "")
            outcome = pos.get("outcome", "unknown")
            pnl = float(pos.get("realizedPnl", 0))
            bought = float(pos.get("totalBought", 0)) or (float(pos.get("size", 0)) * float(pos.get("avgPrice", 0)))

            if condition_id not in market_groups:
                market_groups[condition_id] = {"outcomes": {}}

            if outcome not in market_groups[condition_id]["outcomes"]:
                market_groups[condition_id]["outcomes"][outcome] = []

            market_groups[condition_id]["outcomes"][outcome].append({
                "pnl": pnl,
                "bought": bought,
                "is_resolved": True,
                "resolved_at": pos.get("resolvedAt") or pos.get("timestamp")
            })

        # Process open positions
        for pos in open_positions:
            condition_id = pos.get("conditionId", "")
            outcome = pos.get("outcome", "unknown")
            pnl = float(pos.get("cashPnl", 0))
            bought = float(pos.get("initialValue", 0)) or (float(pos.get("size", 0)) * float(pos.get("avgPrice", 0)))
            current_value = float(pos.get("currentValue", 0))
            is_resolved = current_value == 0

            if condition_id not in market_groups:
                market_groups[condition_id] = {"outcomes": {}}

            if outcome not in market_groups[condition_id]["outcomes"]:
                market_groups[condition_id]["outcomes"][outcome] = []

            market_groups[condition_id]["outcomes"][outcome].append({
                "pnl": pnl,
                "bought": bought,
                "is_resolved": is_resolved,
                "resolved_at": None
            })

        # Convert to trades
        trades = []
        for condition_id, group in market_groups.items():
            outcome_keys = list(group["outcomes"].keys())

            if len(outcome_keys) > 1:
                # Multiple outcomes (hedging) = 1 trade
                total_pnl = 0
                total_bought = 0
                is_resolved = False
                latest_resolved_at = None

                for outcome, entries in group["outcomes"].items():
                    for entry in entries:
                        total_pnl += entry["pnl"]
                        total_bought += entry["bought"]
                        if entry["is_resolved"]:
                            is_resolved = True
                        if entry["resolved_at"]:
                            if not latest_resolved_at or entry["resolved_at"] > latest_resolved_at:
                                latest_resolved_at = entry["resolved_at"]

                trades.append({
                    "condition_id": condition_id,
                    "total_pnl": total_pnl,
                    "total_bought": total_bought,
                    "is_resolved": is_resolved,
                    "resolved_at": latest_resolved_at
                })
            else:
                # Single outcome - each entry is a separate trade
                outcome = outcome_keys[0]
                for entry in group["outcomes"][outcome]:
                    trades.append({
                        "condition_id": condition_id,
                        "total_pnl": entry["pnl"],
                        "total_bought": entry["bought"],
                        "is_resolved": entry["is_resolved"],
                        "resolved_at": entry["resolved_at"]
                    })

        return trades

    def _calculate_max_drawdown(
        self,
        closed_positions: list[dict],
        initial_balance: float = 0
    ) -> float:
        """
        Calculate max drawdown from closed positions.

        Max Drawdown = (peak - trough) / peak * 100
        Track portfolio balance over time based on realized P&L.
        """
        sorted_positions = sorted(
            [p for p in closed_positions if p.get("timestamp")],
            key=lambda p: p.get("timestamp") or 0
        )

        if not sorted_positions:
            return 0

        balance = initial_balance
        max_balance = initial_balance
        max_drawdown_pct = 0

        for pos in sorted_positions:
            pnl = float(pos.get("realizedPnl", 0))
            balance += pnl

            if balance > max_balance:
                max_balance = balance

            if max_balance > 0:
                drawdown_pct = ((max_balance - balance) / max_balance) * 100
                if drawdown_pct > max_drawdown_pct:
                    max_drawdown_pct = drawdown_pct

        return min(round(max_drawdown_pct * 100) / 100, 100)

    def _calculate_metrics(
        self,
        positions: list[dict],
        closed_positions: list[dict],
        current_balance: float = 0
    ) -> dict:
        """
        Calculate all metrics from positions data.

        Trade counting:
        - Same conditionId + different outcomes (hedging) = 1 trade
        - Same conditionId + same outcome (re-entry) = separate trades

        ROI calculation:
        - Account ROI = Total PnL / Initial Balance * 100
        - Initial Balance = Current Balance - Total PnL
        """
        trades = self._group_into_trades(closed_positions, positions)

        realized_pnl = 0
        unrealized_pnl = 0
        total_bought = 0
        win_count = 0
        loss_count = 0
        active_count = 0

        for trade in trades:
            if trade["is_resolved"]:
                realized_pnl += trade["total_pnl"]
                total_bought += trade["total_bought"]
                if trade["total_pnl"] > 0:
                    win_count += 1
                else:
                    loss_count += 1
            else:
                unrealized_pnl += trade["total_pnl"]
                active_count += 1

        total_pnl = realized_pnl + unrealized_pnl
        trade_count = win_count + loss_count

        # ROI = Total PnL / Initial Capital * 100
        initial_capital = current_balance - total_pnl
        if initial_capital > 0:
            roi_all = (total_pnl / initial_capital * 100)
        elif total_pnl > 0 and total_bought > 0:
            # Profitable but withdrew profits (initial_capital <= 0)
            roi_all = (total_pnl / total_bought * 100)
        elif total_pnl < 0 and current_balance == 0:
            # Lost everything: ROI = -100%
            roi_all = -100.0
        else:
            roi_all = 0

        # Win rate from resolved trades
        win_rate_all = (win_count / trade_count * 100) if trade_count > 0 else 0

        # Calculate max drawdown
        drawdown_base = initial_capital if initial_capital > 0 else total_bought
        max_drawdown = self._calculate_max_drawdown(closed_positions, drawdown_base)

        # Count open positions
        open_count = len([p for p in positions if float(p.get("currentValue", 0)) > 0])

        return {
            "realized_pnl": round(realized_pnl, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "total_pnl": round(total_pnl, 2),
            "total_bought": round(total_bought, 2),
            "roi_all": round(roi_all, 2),
            "win_rate_all": round(win_rate_all, 2),
            "win_count": win_count,
            "loss_count": loss_count,
            "trade_count": trade_count,
            "active_count": active_count,
            "open_count": open_count,
            "closed_count": len(closed_positions),
            "max_drawdown": max_drawdown,
        }

    def _calculate_period_metrics(
        self,
        closed_positions: list[dict],
        days: int,
        current_balance: float = 0
    ) -> dict:
        """Calculate metrics for a specific time period (7d, 30d)."""
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)
        cutoff_ts = cutoff.timestamp()

        # Filter positions resolved within the period
        period_positions = []
        for pos in closed_positions:
            resolved_at = pos.get("resolvedAt") or pos.get("timestamp")
            if resolved_at:
                try:
                    if isinstance(resolved_at, (int, float)):
                        resolved_ts = resolved_at / 1000 if resolved_at > 4102444800 else resolved_at
                    else:
                        resolved_ts = datetime.fromisoformat(
                            str(resolved_at).replace("Z", "+00:00")
                        ).timestamp()

                    if resolved_ts >= cutoff_ts:
                        period_positions.append(pos)
                except Exception:
                    pass

        if not period_positions:
            return {
                "pnl": 0, "roi": 0, "volume": 0,
                "trade_count": 0, "win_rate": 0, "drawdown": 0
            }

        # Calculate PnL
        pnl = sum(float(p.get("realizedPnl", 0)) for p in period_positions)

        # Calculate volume
        volume = sum(
            float(p.get("totalBought", 0)) or (float(p.get("size", 0)) * float(p.get("avgPrice", 0)))
            for p in period_positions
        )

        # Calculate win rate
        wins = sum(1 for p in period_positions if float(p.get("realizedPnl", 0)) > 0)
        win_rate = (wins / len(period_positions) * 100) if period_positions else 0

        # Calculate ROI for period
        roi = (pnl / volume * 100) if volume > 0 else 0

        # Calculate drawdown for period
        total_pnl = sum(float(p.get("realizedPnl", 0)) for p in closed_positions)
        initial_balance = max(current_balance - total_pnl, 1)
        drawdown = self._calculate_max_drawdown(period_positions, initial_balance)

        return {
            "pnl": round(pnl, 2),
            "roi": round(roi, 2),
            "volume": round(volume, 2),
            "trade_count": len(period_positions),
            "win_rate": round(win_rate, 2),
            "drawdown": drawdown,
        }

    def refresh_cache(self, address: str) -> None:
        """Add an address to the known wallets cache."""
        self._known_wallets.add(address.lower())

    @property
    def stats(self) -> dict:
        """Get processor statistics."""
        return {
            "known_wallets": len(self._known_wallets),
            "pending_wallets": len(self._pending_wallets),
            "queue_size": self._queue.qsize(),
            "wallets_discovered": self._wallets_discovered,
            "wallets_skipped_cooldown": self._wallets_skipped_cooldown,
            "wallets_processed": self._wallets_processed,
            "trades_stored": self._trades_stored,
            "errors": self._errors,
        }
