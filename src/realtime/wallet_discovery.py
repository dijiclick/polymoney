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

        # Pause/resume control (set via system_settings table)
        self._paused = False
        self._settings_check_interval = 15  # seconds

        # Stats
        self._wallets_discovered = 0
        self._wallets_skipped_cooldown = 0
        self._wallets_processed = 0
        self._trades_stored = 0
        self._errors = 0

    async def initialize(self) -> None:
        """Load existing wallet addresses and last analysis times into memory cache."""
        try:
            logger.info("Loading wallet addresses from 'wallets' into cache...")
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

            # Initialize Polymarket API (needed for main mode; also used for username lookup)
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

    def _check_enabled_flag(self) -> bool:
        """Check system_settings table for wallet_discovery_enabled flag."""
        try:
            result = self.supabase.table("system_settings").select("value").eq(
                "key", "wallet_discovery_enabled"
            ).execute()

            if result.data and len(result.data) > 0:
                value = result.data[0].get("value")
                if isinstance(value, bool):
                    return value
                return str(value).lower() == "true"

            # Default: enabled if setting doesn't exist
            return True
        except Exception as e:
            logger.warning(f"Failed to check wallet_discovery_enabled setting: {e}")
            return True  # Fail-open: keep running on error

    async def poll_settings(self) -> None:
        """Background task that checks the enabled flag and analysis mode periodically."""
        logger.info("Starting wallet discovery settings poller")
        while True:
            try:
                enabled = self._check_enabled_flag()
                was_paused = self._paused
                self._paused = not enabled

                if self._paused and not was_paused:
                    logger.info("Wallet discovery PAUSED via system settings")
                elif not self._paused and was_paused:
                    logger.info("Wallet discovery RESUMED via system settings")

                await asyncio.sleep(self._settings_check_interval)
            except asyncio.CancelledError:
                logger.info("Settings poller stopped")
                break
            except Exception as e:
                logger.error(f"Settings poller error: {e}")
                await asyncio.sleep(self._settings_check_interval)

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
        if self._paused:
            return False

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
                # Wait while paused
                while self._paused:
                    await asyncio.sleep(2)

                addr, usd_value = await self._queue.get()

                try:
                    # Re-check pause after dequeue
                    if self._paused:
                        self._queue.put_nowait((addr, usd_value))
                        self._queue.task_done()
                        continue

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

        # IMPORTANT: /closed-positions API only returns REDEEMED positions (mostly wins).
        # Losing positions stay in /positions with currentValue=0, redeemable=true, cashPnl<0.
        # We must extract these unredeemed losses and add them to closed_positions
        # to get accurate metrics (matching the TypeScript dashboard).
        unredeemed_losses = []
        for pos in positions:
            current_value = float(pos.get("currentValue", 0))
            redeemable = pos.get("redeemable", False)
            cash_pnl = float(pos.get("cashPnl", 0))
            if current_value == 0 and redeemable and cash_pnl < 0:
                # Convert open-position format to closed-position format
                size = float(pos.get("size", 0))
                avg_price = float(pos.get("avgPrice", 0))
                initial_value = float(pos.get("initialValue", 0)) or (size * avg_price)
                unredeemed_losses.append({
                    "conditionId": pos.get("conditionId", ""),
                    "title": pos.get("title", ""),
                    "outcome": pos.get("outcome", ""),
                    "size": pos.get("size", "0"),
                    "totalBought": str(initial_value),
                    "avgPrice": pos.get("avgPrice", "0"),
                    "realizedPnl": cash_pnl,
                    "resolvedAt": pos.get("endDate"),
                    "eventSlug": pos.get("eventSlug") or pos.get("slug", ""),
                })

        if unredeemed_losses:
            logger.info(
                f"[{address[:10]}] Found {len(unredeemed_losses)} unredeemed losses "
                f"from /positions (adding to {len(closed_positions)} closed)"
            )
            closed_positions = closed_positions + unredeemed_losses

        # Filter out unredeemed losses from open positions count
        # (they're resolved, not truly "open")
        open_positions = [
            p for p in positions
            if float(p.get("currentValue", 0)) > 0
        ]

        # Calculate all metrics using our formulas
        # Pass open_positions (not raw positions) to avoid double-counting
        # unredeemed losses as both open and closed
        metrics = self._calculate_metrics(
            positions=open_positions,
            closed_positions=closed_positions,
            current_balance=portfolio_value
        )

        # Calculate period metrics (7d, 30d, all-time)
        metrics_7d = self._calculate_period_metrics(closed_positions, 7, portfolio_value)
        metrics_30d = self._calculate_period_metrics(closed_positions, 30, portfolio_value)
        metrics_all = self._calculate_period_metrics(closed_positions, 36500, portfolio_value)  # 100 years = all time

        # Calculate Growth Quality for each period
        gq_7d = self._calculate_growth_quality(
            [p for p in closed_positions if self._in_period(p, 7)],
            metrics_7d["roi"],
        )
        gq_30d = self._calculate_growth_quality(
            [p for p in closed_positions if self._in_period(p, 30)],
            metrics_30d["roi"],
        )
        gq_all = self._calculate_growth_quality(closed_positions, metrics_all["roi"])

        logger.debug(
            f"Positions={metrics.get('closed_count', 0)}, "
            f"win_rate={metrics.get('win_rate_all', 0):.1f}%"
        )

        # Skip new wallets with fewer than 15 trades
        is_new = address not in self._known_wallets
        if is_new and metrics.get("trade_count", 0) < 15:
            logger.info(
                f"Wallet skipped (< 15 trades): {address[:10]}... "
                f"({metrics.get('trade_count', 0)} trades)"
            )
            return

        # Calculate new copy-trade metrics
        weekly_profit_rate = self._calculate_weekly_profit_rate(closed_positions)
        diff_win_rate_all = self._calculate_diff_win_rate(closed_positions)
        avg_trades_per_day = self._calculate_avg_trades_per_day(closed_positions)
        median_profit_pct = self._calculate_median_profit_pct(closed_positions)

        # Fetch sell ratio and trades per market from raw trades
        sell_ratio, trades_per_market = await self._fetch_trade_stats(address)

        # Top category from event slugs
        all_event_slugs = []
        for p in open_positions:
            slug = p.get("eventSlug") or p.get("slug") or ""
            if slug:
                all_event_slugs.append(slug)
        for p in closed_positions:
            slug = p.get("eventSlug") or p.get("slug") or ""
            if slug:
                all_event_slugs.append(slug)
        top_category = await self._fetch_top_category(all_event_slugs)

        # New metrics for improved copy score
        best_trade_pct = self._calculate_best_trade_pct(closed_positions)
        pf_trend = self._calculate_pf_trend(
            metrics_30d.get("profit_factor", 0),
            metrics.get("profit_factor_all", 0),
        )

        # Copy Score uses 5-pillar formula
        copy_score = self._calculate_copy_score(
            profit_factor_30d=metrics_30d.get("profit_factor", 0),
            profit_factor_all=metrics.get("profit_factor_all", 0),
            drawdown_30d=metrics_30d["drawdown"],
            diff_win_rate_30d=metrics_30d.get("diff_win_rate", 0),
            weekly_profit_rate=weekly_profit_rate,
            trade_count_all=metrics.get("trade_count", 0),
            median_profit_pct=median_profit_pct,
            avg_trades_per_day=avg_trades_per_day,
            overall_pnl=metrics.get("total_pnl", 0),
            best_trade_pct=best_trade_pct,
            pf_trend=pf_trend,
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
            "wins_7d": metrics_7d["wins"],
            "losses_7d": metrics_7d["losses"],
            "growth_quality_7d": gq_7d,
            # 30-day metrics
            "pnl_30d": metrics_30d["pnl"],
            "roi_30d": metrics_30d["roi"],
            "win_rate_30d": metrics_30d["win_rate"],
            "volume_30d": metrics_30d["volume"],
            "trade_count_30d": metrics_30d["trade_count"],
            "drawdown_30d": metrics_30d["drawdown"],
            "wins_30d": metrics_30d["wins"],
            "losses_30d": metrics_30d["losses"],
            "growth_quality_30d": gq_30d,
            # All-time metrics (consistent naming)
            "pnl_all": metrics_all["pnl"],
            "roi_all": metrics_all["roi"],
            "win_rate_all": metrics_all["win_rate"],
            "volume_all": metrics_all["volume"],
            "trade_count_all": metrics_all["trade_count"],
            "drawdown_all": metrics_all["drawdown"],
            "wins_all": metrics_all["wins"],
            "losses_all": metrics_all["losses"],
            "growth_quality_all": gq_all,
            # Sum profit pct per period
            "sum_profit_pct_7d": metrics_7d.get("sum_profit_pct", 0),
            "sum_profit_pct_30d": metrics_30d.get("sum_profit_pct", 0),
            "sum_profit_pct_all": metrics_all.get("sum_profit_pct", 0),
            # Position counts
            "total_positions": metrics.get("closed_count", 0),
            "active_positions": metrics.get("open_count", 0),
            "total_wins": metrics.get("win_count", 0),
            "total_losses": metrics.get("loss_count", 0),
            # PnL breakdown
            "realized_pnl": metrics.get("realized_pnl", 0),
            "unrealized_pnl": metrics.get("unrealized_pnl", 0),
            # Legacy fields (keep for backward compatibility)
            "overall_pnl": metrics.get("total_pnl", 0),
            "overall_roi": metrics.get("roi_all", 0),
            "overall_win_rate": metrics.get("win_rate_all", 0),
            "total_volume": metrics.get("total_bought", 0),
            "total_trades": metrics.get("trade_count", 0),
            # Copy-trade metrics
            "profit_factor_30d": metrics_30d.get("profit_factor", 0),
            "profit_factor_all": metrics.get("profit_factor_all", 0),
            "diff_win_rate_30d": metrics_30d.get("diff_win_rate", 0),
            "diff_win_rate_all": diff_win_rate_all,
            "weekly_profit_rate": weekly_profit_rate,
            "copy_score": copy_score,
            "avg_trades_per_day": avg_trades_per_day,
            "top_category": top_category,
            "median_profit_pct": median_profit_pct,
            "best_trade_pct": best_trade_pct,
            "pf_trend": pf_trend,
            "sell_ratio": sell_ratio,
            "trades_per_market": trades_per_market,
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
            bought = float(pos.get("totalBought", 0)) or float(pos.get("initialValue", 0)) or (float(pos.get("size", 0)) * float(pos.get("avgPrice", 0)))

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
        # NOTE: Open positions are ALWAYS unrealized, even if currentValue = 0
        # The market hasn't officially resolved, so we don't count them as realized
        for pos in open_positions:
            condition_id = pos.get("conditionId", "")
            outcome = pos.get("outcome", "unknown")
            pnl = float(pos.get("cashPnl", 0))
            bought = float(pos.get("totalBought", 0)) or float(pos.get("initialValue", 0)) or (float(pos.get("size", 0)) * float(pos.get("avgPrice", 0)))

            if condition_id not in market_groups:
                market_groups[condition_id] = {"outcomes": {}}

            if outcome not in market_groups[condition_id]["outcomes"]:
                market_groups[condition_id]["outcomes"][outcome] = []

            market_groups[condition_id]["outcomes"][outcome].append({
                "pnl": pnl,
                "bought": bought,
                "is_resolved": False,  # Open positions are always unrealized
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
                            # Normalize to string for safe comparison
                            # (API can return int timestamps or ISO date strings)
                            entry_ra = str(entry["resolved_at"])
                            latest_ra = str(latest_resolved_at) if latest_resolved_at else ""
                            if not latest_resolved_at or entry_ra > latest_ra:
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
        initial_balance: float = 0,
    ) -> float:
        """
        Calculate max drawdown from equity curve.

        Tracks balance starting from initial_balance, adding realized PnL
        for each position chronologically.
        Max Drawdown = (peak - trough) / peak * 100
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
        gross_wins = 0
        gross_losses = 0

        for trade in trades:
            if trade["is_resolved"]:
                realized_pnl += trade["total_pnl"]
                total_bought += trade["total_bought"]
                if trade["total_pnl"] > 0:
                    win_count += 1
                    gross_wins += trade["total_pnl"]
                else:
                    loss_count += 1
                    gross_losses += abs(trade["total_pnl"])
            else:
                unrealized_pnl += trade["total_pnl"]
                active_count += 1

        total_pnl = realized_pnl + unrealized_pnl
        trade_count = win_count + loss_count

        # ROI = Total PnL / Initial Capital * 100
        # Initial Capital estimated as current_balance - total_pnl (what was deposited)
        initial_capital = current_balance - total_pnl
        if initial_capital > 0:
            roi_all = (total_pnl / initial_capital * 100)
        elif total_pnl > 0 and total_bought > 0:
            roi_all = (total_pnl / total_bought * 100)
        else:
            roi_all = 0

        # Win rate from resolved trades
        win_rate_all = (win_count / trade_count * 100) if trade_count > 0 else 0

        # Calculate max drawdown
        # Include volume-based floor for high-frequency traders with low current balance
        avg_trade_size = total_bought / trade_count if trade_count > 0 else 0
        drawdown_base = max(current_balance - realized_pnl - unrealized_pnl, current_balance, avg_trade_size * 3, 1)
        max_drawdown = self._calculate_max_drawdown(closed_positions, drawdown_base)

        # Count unique markets (conditionId), not raw position entries
        # Each market has YES/NO outcomes, so raw len() double-counts
        unique_closed_markets = len(set(
            p.get("conditionId", "") for p in closed_positions if p.get("conditionId")
        ))
        unique_open_markets = len(set(
            p.get("conditionId", "") for p in positions
            if p.get("conditionId") and float(p.get("currentValue", 0)) > 0
        ))

        # Profit Factor = gross wins / abs(gross losses)
        if gross_losses > 0:
            profit_factor_all = round(gross_wins / gross_losses, 2)
        elif gross_wins > 0:
            profit_factor_all = 10.0  # Cap when no losses
        else:
            profit_factor_all = 0

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
            "open_count": unique_open_markets,
            "closed_count": unique_closed_markets,
            "max_drawdown": max_drawdown,
            "gross_wins": round(gross_wins, 2),
            "gross_losses": round(gross_losses, 2),
            "profit_factor_all": profit_factor_all,
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
                "trade_count": 0, "win_rate": 0, "drawdown": 0,
                "sum_profit_pct": 0,
            }

        # Group by conditionId to count unique markets (not raw entries)
        # Each market has YES/NO outcomes, raw count double-counts
        market_pnl: dict[str, float] = {}
        # Track per-market avg entry price for difficulty-weighted win rate
        market_difficulty: dict[str, list[float]] = {}
        for p in period_positions:
            cid = p.get("conditionId", "")
            rpnl = float(p.get("realizedPnl", 0))
            market_pnl[cid] = market_pnl.get(cid, 0) + rpnl
            # avgPrice = entry probability (what they paid per share)
            avg_price = float(p.get("avgPrice", 0.5))
            avg_price = max(0.01, min(avg_price, 0.99))  # Clamp to valid range
            if cid not in market_difficulty:
                market_difficulty[cid] = []
            market_difficulty[cid].append(avg_price)

        # Calculate PnL
        pnl = sum(market_pnl.values())

        # Calculate volume
        volume = sum(
            float(p.get("totalBought", 0)) or float(p.get("initialValue", 0)) or (float(p.get("size", 0)) * float(p.get("avgPrice", 0)))
            for p in period_positions
        )

        # Sum of per-trade profit percentages
        sum_profit_pct = 0.0
        for p in period_positions:
            realized_pnl = float(p.get("realizedPnl", 0))
            initial_value = float(p.get("totalBought", 0) or 0)
            if initial_value <= 0:
                initial_value = float(p.get("initialValue", 0))
            if initial_value <= 0:
                initial_value = float(p.get("size", 0)) * float(p.get("avgPrice", 0))
            if initial_value > 0:
                sum_profit_pct += (realized_pnl / initial_value) * 100

        # Calculate win rate from unique markets
        wins = sum(1 for v in market_pnl.values() if v > 0)
        trade_count = len(market_pnl)
        win_rate = (wins / trade_count * 100) if trade_count > 0 else 0

        # Profit Factor for period
        gross_wins = sum(v for v in market_pnl.values() if v > 0)
        gross_losses_abs = sum(abs(v) for v in market_pnl.values() if v < 0)
        if gross_losses_abs > 0:
            profit_factor = round(gross_wins / gross_losses_abs, 2)
        elif gross_wins > 0:
            profit_factor = 10.0
        else:
            profit_factor = 0

        # Difficulty-weighted win rate for period
        # difficulty = 1 - avg_entry_price (lower entry price = harder bet = more credit)
        total_difficulty = 0
        wins_difficulty = 0
        for cid, prices in market_difficulty.items():
            avg_entry = sum(prices) / len(prices)
            difficulty = 1 - avg_entry
            total_difficulty += difficulty
            if market_pnl.get(cid, 0) > 0:
                wins_difficulty += difficulty
        diff_win_rate = (wins_difficulty / total_difficulty * 100) if total_difficulty > 0 else 0

        # ROI = Period PnL / Starting Balance
        # Starting balance estimated as current_balance - period_pnl
        estimated_start = current_balance - pnl
        if estimated_start > 0:
            roi = (pnl / estimated_start * 100)
        elif pnl > 0 and volume > 0:
            roi = (pnl / volume * 100)
        else:
            roi = 0

        # Calculate drawdown for period
        # Use volume-based floor to handle high-frequency traders with low
        # current balance (e.g., profits withdrawn, capital rotated rapidly)
        avg_position_size = volume / trade_count if trade_count > 0 else 0
        initial_balance = max(current_balance - pnl, current_balance, avg_position_size * 3, 1)
        drawdown = self._calculate_max_drawdown(period_positions, initial_balance)

        losses = trade_count - wins

        return {
            "pnl": round(pnl, 2),
            "roi": round(roi, 2),
            "volume": round(volume, 2),
            "trade_count": trade_count,
            "win_rate": round(win_rate, 2),
            "wins": wins,
            "losses": losses,
            "drawdown": drawdown,
            "profit_factor": profit_factor,
            "diff_win_rate": round(diff_win_rate, 2),
            "sum_profit_pct": round(sum_profit_pct, 2),
        }

    def _calculate_weekly_profit_rate(self, closed_positions: list[dict]) -> float:
        """
        Calculate percentage of active weeks that were profitable.
        Groups closed positions by ISO week and counts profitable weeks.
        """
        if not closed_positions:
            return 0

        # Group PnL by ISO week
        week_pnl: dict[str, float] = {}
        for pos in closed_positions:
            resolved_at = pos.get("resolvedAt") or pos.get("timestamp")
            if not resolved_at:
                continue
            try:
                if isinstance(resolved_at, (int, float)):
                    resolved_ts = resolved_at / 1000 if resolved_at > 4102444800 else resolved_at
                    dt = datetime.fromtimestamp(resolved_ts, tz=timezone.utc)
                else:
                    dt = datetime.fromisoformat(str(resolved_at).replace("Z", "+00:00"))
                iso_year, iso_week, _ = dt.isocalendar()
                week_key = f"{iso_year}-W{iso_week:02d}"
                pnl = float(pos.get("realizedPnl", 0))
                week_pnl[week_key] = week_pnl.get(week_key, 0) + pnl
            except Exception:
                continue

        if not week_pnl:
            return 0

        profitable_weeks = sum(1 for v in week_pnl.values() if v > 0)
        return round(profitable_weeks / len(week_pnl) * 100, 2)

    def _calculate_diff_win_rate(self, closed_positions: list[dict]) -> float:
        """
        Calculate difficulty-weighted win rate from closed positions.
        Difficulty = 1 - avgPrice (lower entry price = harder bet = more credit).
        """
        if not closed_positions:
            return 0

        # Group by conditionId
        market_pnl: dict[str, float] = {}
        market_prices: dict[str, list[float]] = {}

        for pos in closed_positions:
            cid = pos.get("conditionId", "")
            if not cid:
                continue
            pnl = float(pos.get("realizedPnl", 0))
            avg_price = float(pos.get("avgPrice", 0.5))
            avg_price = max(0.01, min(avg_price, 0.99))

            market_pnl[cid] = market_pnl.get(cid, 0) + pnl
            if cid not in market_prices:
                market_prices[cid] = []
            market_prices[cid].append(avg_price)

        if not market_pnl:
            return 0

        total_difficulty = 0
        wins_difficulty = 0
        for cid, prices in market_prices.items():
            avg_entry = sum(prices) / len(prices)
            difficulty = 1 - avg_entry
            total_difficulty += difficulty
            if market_pnl.get(cid, 0) > 0:
                wins_difficulty += difficulty

        return round((wins_difficulty / total_difficulty * 100) if total_difficulty > 0 else 0, 2)

    def _calculate_avg_trades_per_day(self, closed_positions: list[dict]) -> float:
        """Calculate average trades per active day from closed positions."""
        if not closed_positions:
            return 0

        # Collect unique active days
        active_days: set[str] = set()
        for pos in closed_positions:
            resolved_at = pos.get("resolvedAt") or pos.get("timestamp")
            if not resolved_at:
                continue
            try:
                if isinstance(resolved_at, (int, float)):
                    resolved_ts = resolved_at / 1000 if resolved_at > 4102444800 else resolved_at
                    dt = datetime.fromtimestamp(resolved_ts, tz=timezone.utc)
                else:
                    dt = datetime.fromisoformat(str(resolved_at).replace("Z", "+00:00"))
                active_days.add(dt.strftime("%Y-%m-%d"))
            except Exception:
                continue

        if not active_days:
            return 0

        # Count unique markets (trades) rather than raw positions
        unique_markets = len(set(p.get("conditionId", "") for p in closed_positions if p.get("conditionId")))
        return round(unique_markets / len(active_days), 2)

    @staticmethod
    def _calculate_median_profit_pct(closed_positions: list[dict]) -> float | None:
        """
        Calculate median profit percentage per closed trade with IQR outlier removal.

        For each closed position: profit_pct = (realizedPnl / initialValue) * 100
        Then remove outliers via IQR method and return median.

        Returns None if fewer than 3 valid positions.
        """
        profit_pcts: list[float] = []

        for pos in closed_positions:
            realized_pnl = float(pos.get("realizedPnl", 0))
            # Try totalBought first (newer API format), then initialValue, then size*avgPrice
            initial_value = 0
            total_bought = pos.get("totalBought")
            if total_bought is not None:
                initial_value = float(total_bought)
            if initial_value <= 0:
                initial_value = float(pos.get("initialValue", 0))
            if initial_value <= 0:
                size = float(pos.get("size", 0))
                avg_price = float(pos.get("avgPrice", 0))
                initial_value = size * avg_price

            if initial_value <= 0:
                continue

            pct = (realized_pnl / initial_value) * 100
            profit_pcts.append(pct)

        if len(profit_pcts) < 3:
            return None

        profit_pcts.sort()
        n = len(profit_pcts)

        def interpolate(sorted_data: list[float], frac_idx: float) -> float:
            lower = int(frac_idx)
            upper = min(lower + 1, len(sorted_data) - 1)
            weight = frac_idx - lower
            return sorted_data[lower] * (1 - weight) + sorted_data[upper] * weight

        q1 = interpolate(profit_pcts, n * 0.25)
        q3 = interpolate(profit_pcts, n * 0.75)
        iqr = q3 - q1

        lower_bound = q1 - 1.5 * iqr
        upper_bound = q3 + 1.5 * iqr

        filtered = [p for p in profit_pcts if lower_bound <= p <= upper_bound]
        if not filtered:
            return None

        filtered.sort()
        mid = len(filtered) // 2
        if len(filtered) % 2 == 0:
            median_val = (filtered[mid - 1] + filtered[mid]) / 2
        else:
            median_val = filtered[mid]

        return round(median_val, 2)

    @staticmethod
    def _in_period(position: dict, days: int) -> bool:
        """Check if a position's resolvedAt is within the last N days."""
        resolved_at = position.get("resolvedAt") or position.get("timestamp")
        if not resolved_at:
            return False
        try:
            if isinstance(resolved_at, (int, float)):
                ts = resolved_at / 1000 if resolved_at > 4102444800 else resolved_at
            else:
                ts = datetime.fromisoformat(
                    str(resolved_at).replace("Z", "+00:00")
                ).timestamp()
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp()
            return ts >= cutoff
        except Exception:
            return False

    @staticmethod
    def _calculate_growth_quality(
        closed_positions: list[dict],
        roi: float,
    ) -> int:
        """
        Calculate Growth Quality score (1-10).
        Combines R² of cumulative PnL equity curve (60%) with ROI magnitude (40%).

        R² measures steadiness: 1.0 = perfectly linear growth, 0 = random.
        """
        # Filter positions with resolvedAt and sort by time
        sorted_positions = []
        for p in closed_positions:
            resolved_at = p.get("resolvedAt") or p.get("timestamp")
            if resolved_at:
                try:
                    if isinstance(resolved_at, (int, float)):
                        ts = resolved_at / 1000 if resolved_at > 4102444800 else resolved_at
                    else:
                        ts = datetime.fromisoformat(
                            str(resolved_at).replace("Z", "+00:00")
                        ).timestamp()
                    sorted_positions.append((ts, float(p.get("realizedPnl", 0))))
                except Exception:
                    pass

        sorted_positions.sort(key=lambda x: x[0])

        if len(sorted_positions) < 3:
            return 0

        # Build cumulative PnL points
        cum_pnl = 0.0
        points = []
        for i, (_, pnl) in enumerate(sorted_positions):
            cum_pnl += pnl
            points.append((float(i), cum_pnl))

        n = len(points)
        sum_x = sum(p[0] for p in points)
        sum_y = sum(p[1] for p in points)
        sum_xy = sum(p[0] * p[1] for p in points)
        sum_xx = sum(p[0] * p[0] for p in points)

        mean_y = sum_y / n
        ss_tot = sum((p[1] - mean_y) ** 2 for p in points)

        if ss_tot == 0:
            return 7 if roi > 0 else 1

        denom = n * sum_xx - sum_x * sum_x
        if denom == 0:
            return 1

        slope = (n * sum_xy - sum_x * sum_y) / denom
        intercept = (sum_y - slope * sum_x) / n

        ss_res = sum((p[1] - (intercept + slope * p[0])) ** 2 for p in points)
        r2 = max(1 - ss_res / ss_tot, 0)

        # Only reward upward trends
        if slope <= 0:
            return 1

        steadiness = r2
        return_score = min(max(roi / 20, 0), 1.0)
        raw = steadiness * 0.6 + return_score * 0.4
        return max(1, min(10, round(raw * 9 + 1)))

    @staticmethod
    def _calculate_best_trade_pct(closed_positions: list[dict]) -> float | None:
        """
        Calculate what % of total positive PnL comes from the single best trade.

        A high value (e.g. 80%) means the trader's profits depend on one lucky bet.
        A low value (e.g. 10%) means profits are well-distributed across trades.

        Returns None if no positive PnL trades.
        """
        # Group by conditionId to get per-market PnL
        market_pnl: dict[str, float] = {}
        for pos in closed_positions:
            cid = pos.get("conditionId", "")
            if not cid:
                continue
            pnl = float(pos.get("realizedPnl", 0))
            market_pnl[cid] = market_pnl.get(cid, 0) + pnl

        positive_pnls = [v for v in market_pnl.values() if v > 0]
        if not positive_pnls:
            return None

        total_positive = sum(positive_pnls)
        if total_positive <= 0:
            return None

        max_single = max(positive_pnls)
        return round((max_single / total_positive) * 100, 2)

    @staticmethod
    def _calculate_pf_trend(profit_factor_30d: float, profit_factor_all: float) -> float | None:
        """
        Calculate PF trend = profit_factor_30d / profit_factor_all.

        > 1.0 = improving edge (recent PF better than historical)
        < 1.0 = decaying edge (recent PF worse than historical)
        = 1.0 = stable

        Returns None if either PF is 0 or unavailable.
        """
        if not profit_factor_all or profit_factor_all <= 0:
            return None
        if profit_factor_30d is None or profit_factor_30d < 0:
            return None
        return round(profit_factor_30d / profit_factor_all, 2)

    @staticmethod
    def _calculate_copy_score(
        profit_factor_30d: float,
        profit_factor_all: float,
        drawdown_30d: float,
        diff_win_rate_30d: float,
        weekly_profit_rate: float,
        trade_count_all: int,
        median_profit_pct: float | None = None,
        avg_trades_per_day: float | None = None,
        overall_pnl: float = 0,
        best_trade_pct: float | None = None,
        pf_trend: float | None = None,
    ) -> int:
        """
        Calculate composite copy-trade score (0-100).

        5-pillar formula:
        - Edge (25%): Blended Profit Factor (70% 30d + 30% all-time), normalized 1.2-3.0
        - Skill (20%): Difficulty-weighted win rate, normalized 45%-75%
        - Consistency (20%): Weekly Profit Rate, normalized 40%-85%
        - Risk (15%): Inverse drawdown, DD 5%-25%
        - Discipline (10%): Inverse best_trade_pct, penalizes one-hit wonders

        Multiplied by:
        - Confidence: min(1, trade_count_all / 150) — stricter than before
        - Decay: pf_trend ratio clamped to [0.5, 1.0] — penalizes fading edge
        """
        # Hard filters — all must pass or score = 0
        if overall_pnl < 0:
            return 0
        if trade_count_all < 40:
            return 0
        if profit_factor_30d < 1.2:
            return 0
        if median_profit_pct is None or median_profit_pct < 5.0:
            return 0
        if avg_trades_per_day is not None and (avg_trades_per_day < 0.5 or avg_trades_per_day > 25):
            return 0

        # Pillar 1: Edge (25%) — Blended PF (70% recent + 30% all-time)
        blended_pf = profit_factor_30d * 0.7 + (profit_factor_all or profit_factor_30d) * 0.3
        edge_score = min(max((blended_pf - 1.2) / (3.0 - 1.2), 0), 1.0)

        # Pillar 2: Skill (20%) — Difficulty-weighted win rate 45% → 0, 75%+ → 1.0
        skill_score = min(max((diff_win_rate_30d - 45) / (75 - 45), 0), 1.0)

        # Pillar 3: Consistency (20%) — Weekly profit rate 40% → 0, 85%+ → 1.0
        consistency_score = min(max((weekly_profit_rate - 40) / (85 - 40), 0), 1.0)

        # Pillar 4: Risk (15%) — Inverse drawdown: DD 5% → 1.0, DD 25%+ → 0
        if drawdown_30d <= 0:
            risk_score = 1.0
        else:
            risk_score = min(max((25 - drawdown_30d) / (25 - 5), 0), 1.0)

        # Pillar 5: Discipline (10%) — Penalizes one-hit wonders
        # best_trade_pct = 15% → full score, 85%+ → zero
        if best_trade_pct is not None and best_trade_pct > 0:
            discipline_score = min(max((1 - best_trade_pct / 100 - 0.15) / (0.85 - 0.15), 0), 1.0)
        else:
            discipline_score = 0.5  # Unknown = neutral

        # Weighted sum
        raw_score = (
            edge_score * 0.25 +
            skill_score * 0.20 +
            consistency_score * 0.20 +
            risk_score * 0.15 +
            discipline_score * 0.10
        ) * 100

        # Confidence multiplier — stricter: 150 trades for full confidence
        confidence = min(1.0, trade_count_all / 150)

        # Decay multiplier — penalizes fading edge
        if pf_trend is not None and pf_trend > 0:
            decay = max(0.5, min(pf_trend, 1.0))
        else:
            decay = 1.0  # Unknown = no penalty

        return min(round(raw_score * confidence * decay), 100)

    async def _fetch_trade_stats(self, address: str) -> tuple[float, float]:
        """
        Fetch sell_ratio and trades_per_market from Polymarket data API trades endpoint.

        Returns (sell_ratio, trades_per_market) or (0, 0) on failure.
        sell_ratio = sell_count / total * 100
        trades_per_market = total_trades / unique_markets
        """
        if not self._api:
            return 0, 0

        import aiohttp

        try:
            await self._api._ensure_session()

            all_trades: list[dict] = []
            offset = 0
            limit = 500

            while len(all_trades) < 2000:
                url = (
                    f"https://data-api.polymarket.com/trades"
                    f"?user={address}&limit={limit}&offset={offset}"
                )
                async with self._api._session.get(
                    url, timeout=aiohttp.ClientTimeout(total=15)
                ) as resp:
                    if resp.status != 200:
                        break
                    data = await resp.json()
                    if not data or not isinstance(data, list):
                        break
                    all_trades.extend(data)
                    if len(data) < limit:
                        break
                    offset += limit

            if not all_trades:
                return 0, 0

            buy_count = sum(1 for t in all_trades if t.get("side") == "BUY")
            sell_count = sum(1 for t in all_trades if t.get("side") == "SELL")
            total = buy_count + sell_count
            sell_ratio = (sell_count / total * 100) if total > 0 else 0

            unique_markets = len(set(
                t.get("conditionId", "") for t in all_trades if t.get("conditionId")
            ))
            tpm = (total / unique_markets) if unique_markets > 0 else 0

            return round(sell_ratio, 2), round(tpm, 2)

        except Exception as e:
            logger.debug(f"Failed to fetch trade stats for {address[:10]}: {e}")
            return 0, 0

    async def _fetch_top_category(self, event_slugs: list[str]) -> str | None:
        """
        Fetch event categories from Gamma API and return the most common one.

        Batches slugs into chunks of 20 to avoid URL length limits.
        """
        if not self._api:
            return None

        unique_slugs = list(set(s for s in event_slugs if s))
        if not unique_slugs:
            return None

        import aiohttp
        from collections import Counter

        CHUNK_SIZE = 20
        category_counts: Counter = Counter()

        try:
            await self._api._ensure_session()

            chunks = [
                unique_slugs[i:i + CHUNK_SIZE]
                for i in range(0, len(unique_slugs), CHUNK_SIZE)
            ]

            for chunk in chunks:
                try:
                    slug_params = "&".join(
                        f"slug={s}" for s in chunk
                    )
                    url = f"https://gamma-api.polymarket.com/events?limit={len(chunk)}&{slug_params}"

                    async with self._api._session.get(
                        url,
                        timeout=aiohttp.ClientTimeout(total=10)
                    ) as response:
                        if response.status != 200:
                            continue
                        events = await response.json()
                        if not isinstance(events, list):
                            continue

                        for event in events:
                            slug = event.get("slug")
                            tags = event.get("tags") or []
                            if slug and tags:
                                # Extract category from tags
                                category = None
                                if isinstance(tags, list):
                                    for tag in tags:
                                        label = tag.get("label", "") if isinstance(tag, dict) else str(tag)
                                        if label and label not in ("All", "Featured"):
                                            category = label
                                            break
                                    if not category and tags:
                                        first = tags[0]
                                        category = first.get("label", "") if isinstance(first, dict) else str(first)
                                if category:
                                    # Count for each position with this slug
                                    slug_count = event_slugs.count(slug)
                                    category_counts[category] += slug_count
                except Exception:
                    continue

            if category_counts:
                return category_counts.most_common(1)[0][0]
        except Exception as e:
            logger.debug(f"Error fetching categories: {e}")

        return None

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
            "paused": self._paused,
        }
