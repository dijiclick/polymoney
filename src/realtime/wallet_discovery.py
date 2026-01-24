"""
Wallet discovery processor for live trade monitoring.

Discovers new wallets from live trades >= $100 and fetches their trade history.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable

from supabase import Client

from ..scrapers.data_api import PolymarketDataAPI
from ..scrapers.goldsky_api import GoldskyAPI

logger = logging.getLogger(__name__)


class WalletDiscoveryProcessor:
    """
    Async processor that discovers new wallets from live trades.

    When a trade >= $100 comes in from an unknown wallet:
    1. Queue the wallet for processing
    2. Fetch portfolio value and trade history from Polymarket API
    3. Calculate 7d and 30d metrics (PnL, ROI, win rate, etc.)
    4. Store wallet with metrics and trades in database
    """

    # Processing settings
    # Each wallet needs 4 API calls, rate limit is 60/min
    # With 3 workers processing 1 wallet every 0.8s each = ~15 wallets/min = ~60 API calls/min
    NUM_WORKERS = 3
    REQUEST_INTERVAL = 0.8  # seconds between wallet processing per worker

    MAX_QUEUE_SIZE = 500  # Larger queue to handle bursts
    HISTORY_DAYS = 30
    REANALYSIS_COOLDOWN_DAYS = 3  # Don't re-analyze wallets within this period

    def __init__(self, supabase: Client, use_goldsky: bool = True):
        """
        Initialize the wallet discovery processor.

        Args:
            supabase: Supabase client instance
            use_goldsky: If True, use Goldsky for complete trade history (volume/counts)
        """
        self.supabase = supabase
        self._api: Optional[PolymarketDataAPI] = None
        self._goldsky: Optional[GoldskyAPI] = None
        self._use_goldsky = use_goldsky

        # In-memory caches for O(1) lookup
        self._known_wallets: set[str] = set()
        self._wallet_last_analyzed: dict[str, datetime] = {}  # addr -> last analysis time
        self._pending_wallets: set[str] = set()

        # Processing queue (priority queue would be nice but asyncio doesn't have one)
        self._queue: asyncio.Queue[tuple[str, float]] = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)

        # Per-worker rate limiting
        self._worker_last_request: dict[int, datetime] = {}

        # Stats
        self._wallets_discovered = 0  # New wallets seen (>= $100 trades)
        self._wallets_skipped_cooldown = 0  # Skipped due to recent analysis
        self._wallets_processed = 0  # Actually analyzed
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

                # Parse last analysis time
                if w.get("metrics_updated_at"):
                    try:
                        last_analyzed = datetime.fromisoformat(
                            str(w["metrics_updated_at"]).replace("Z", "+00:00")
                        )
                        self._wallet_last_analyzed[addr] = last_analyzed
                    except Exception:
                        pass

            logger.info(f"Loaded {len(self._known_wallets)} wallet addresses into cache")

            # Initialize API clients
            self._api = PolymarketDataAPI()
            await self._api.__aenter__()

            # Initialize Goldsky API for complete trade history
            if self._use_goldsky:
                self._goldsky = GoldskyAPI()
                await self._goldsky.__aenter__()
                logger.info("Goldsky API initialized for complete trade history")

        except Exception as e:
            logger.error(f"Failed to initialize wallet discovery: {e}")
            self._errors += 1

    async def shutdown(self) -> None:
        """Clean up resources."""
        if self._api:
            await self._api.__aexit__(None, None, None)
        if self._goldsky:
            await self._goldsky.__aexit__(None, None, None)

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

        # Always count as discovered (>= $100 trade)
        self._wallets_discovered += 1

        # Skip if already pending
        if addr in self._pending_wallets:
            return False

        # Check if wallet was recently analyzed (within cooldown period)
        if addr in self._known_wallets:
            last_analyzed = self._wallet_last_analyzed.get(addr)
            if last_analyzed:
                now = datetime.now(timezone.utc)
                days_since = (now - last_analyzed).days
                if days_since < self.REANALYSIS_COOLDOWN_DAYS:
                    # Skip - analyzed recently
                    return False

            # Wallet exists but needs re-analysis (older than cooldown)
            logger.debug(f"Wallet {addr[:10]}... needs re-analysis")

        # Try to queue
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
            # Queue is full - only add if this is a high-value trade
            if usd_value >= 1000:
                logger.warning(f"Queue full, but high-value trade (${usd_value:,.0f}) - wallet will be processed later")
            return False

    async def process_queue(self, worker_id: int = 0) -> None:
        """Background task to process discovery queue.

        Args:
            worker_id: Unique ID for this worker (for rate limiting)
        """
        logger.info(f"Starting wallet discovery worker {worker_id}")
        self._worker_last_request[worker_id] = datetime.now(timezone.utc)

        while True:
            try:
                # Get wallet from queue
                addr, usd_value = await self._queue.get()

                try:
                    # Rate limit - wait between requests for this worker
                    await self._rate_limit_wait(worker_id)

                    # Process the wallet
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

        ALL METRICS come from Goldsky on-chain data:
        - Volume, trade counts (orderbook subgraph)
        - PnL, win rate, ROI (PnL subgraph)
        - Position counts (PnL subgraph)

        Polymarket REST API is only used for:
        - Profile info (username, profile image)
        - Portfolio value (current balance)

        Args:
            address: The wallet address to process
        """
        if not self._goldsky:
            raise RuntimeError("Goldsky API client not initialized")

        logger.debug(f"Processing wallet: {address[:10]}...")

        # Fetch data in parallel:
        # - Goldsky: ALL metrics (volume, trades, PnL, win rate, ROI, positions)
        # - Polymarket API: Only profile info and portfolio value
        api_tasks = [
            self._goldsky.get_complete_metrics(address),  # ALL metrics from Goldsky
            self._api.get_portfolio_value(address) if self._api else asyncio.coroutine(lambda: 0)(),
            self._api.get_profile(address) if self._api else asyncio.coroutine(lambda: {})(),
        ]

        results = await asyncio.gather(*api_tasks, return_exceptions=True)

        # Unpack results
        goldsky_metrics = results[0] if not isinstance(results[0], Exception) else None
        portfolio_value = results[1] if not isinstance(results[1], Exception) else 0
        profile = results[2] if not isinstance(results[2], Exception) else {}

        if goldsky_metrics is None:
            logger.error(f"Failed to fetch Goldsky metrics for {address[:10]}...")
            self._errors += 1
            return

        logger.debug(
            f"Goldsky: {goldsky_metrics.get('trades_fetched', 0)} trades, "
            f"${goldsky_metrics.get('volume_30d', 0):,.0f} volume (30d), "
            f"{goldsky_metrics.get('win_rate_all', 0):.1f}% win rate"
        )

        # All metrics come from Goldsky now (including ROI and drawdown for each period)
        wallet_data = {
            "address": address,
            "source": "live",
            "balance": portfolio_value,
            "balance_updated_at": datetime.now(timezone.utc).isoformat(),
            "username": profile.get("pseudonym") or profile.get("name"),
            "account_created_at": profile.get("createdAt"),
            # ===== 7-DAY METRICS (from Goldsky) =====
            "pnl_7d": goldsky_metrics.get("pnl_7d", 0),
            "roi_7d": goldsky_metrics.get("roi_7d", 0),
            "win_rate_7d": goldsky_metrics.get("win_rate_7d", 0),
            "volume_7d": goldsky_metrics.get("volume_7d", 0),
            "trade_count_7d": goldsky_metrics.get("trade_count_7d", 0),
            "drawdown_7d": goldsky_metrics.get("drawdown_7d", 0),
            # ===== 30-DAY METRICS (from Goldsky) =====
            "pnl_30d": goldsky_metrics.get("pnl_30d", 0),
            "roi_30d": goldsky_metrics.get("roi_30d", 0),
            "win_rate_30d": goldsky_metrics.get("win_rate_30d", 0),
            "volume_30d": goldsky_metrics.get("volume_30d", 0),
            "trade_count_30d": goldsky_metrics.get("trade_count_30d", 0),
            "drawdown_30d": goldsky_metrics.get("drawdown_30d", 0),
            # ===== OVERALL/ALL-TIME METRICS (from Goldsky) =====
            "total_positions": goldsky_metrics.get("total_positions", 0),
            "active_positions": goldsky_metrics.get("open_positions", 0),
            "total_wins": goldsky_metrics.get("winning_positions", 0),
            "total_losses": goldsky_metrics.get("losing_positions", 0),
            "realized_pnl": goldsky_metrics.get("realized_pnl", 0),
            "unrealized_pnl": 0,  # Would need positions subgraph for this
            "overall_pnl": goldsky_metrics.get("realized_pnl", 0),
            "overall_roi": goldsky_metrics.get("roi_all", 0),
            "overall_win_rate": goldsky_metrics.get("win_rate_all", 0),
            "total_volume": goldsky_metrics.get("volume_30d", 0),  # Use 30d as proxy
            "total_trades": goldsky_metrics.get("trade_count_30d", 0),  # Use 30d as proxy
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
            f"positions={goldsky_metrics.get('total_positions', 0)} | "
            f"win_rate={goldsky_metrics.get('win_rate_all', 0):.1f}% | "
            f"pnl=${goldsky_metrics.get('realized_pnl', 0):,.0f}"
        )

    async def _store_trades(self, address: str, trades: list[dict]) -> int:
        """
        Store trades in wallet_trades table.

        Args:
            address: Wallet address
            trades: List of trade records from API

        Returns:
            Number of trades stored
        """
        if not trades:
            return 0

        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=self.HISTORY_DAYS)

        trade_records = []
        for trade in trades:
            # Parse timestamp
            timestamp = trade.get("timestamp")
            if timestamp:
                try:
                    if isinstance(timestamp, (int, float)):
                        executed_at = datetime.fromtimestamp(timestamp, tz=timezone.utc)
                    else:
                        executed_at = datetime.fromisoformat(str(timestamp).replace("Z", "+00:00"))
                except Exception:
                    executed_at = now
            else:
                executed_at = now

            # Skip trades older than cutoff
            if executed_at < cutoff:
                continue

            # Get USD value
            usd_value = float(trade.get("usdcSize") or trade.get("usdValue") or 0)
            if usd_value == 0:
                size = float(trade.get("size") or 0)
                price = float(trade.get("price") or 0)
                usd_value = size * price

            trade_record = {
                "address": address,
                "trade_id": str(trade.get("id") or trade.get("transactionHash") or f"{address}_{timestamp}"),
                "condition_id": trade.get("conditionId"),
                "market_slug": trade.get("slug"),
                "market_title": trade.get("title"),
                "event_slug": trade.get("eventSlug"),
                "category": trade.get("category"),
                "side": trade.get("side", "").upper(),
                "outcome": trade.get("outcome"),
                "outcome_index": trade.get("outcomeIndex"),
                "size": float(trade.get("size") or 0),
                "price": float(trade.get("price") or 0),
                "usd_value": usd_value,
                "executed_at": executed_at.isoformat(),
                "tx_hash": trade.get("transactionHash"),
            }
            trade_records.append(trade_record)

        if trade_records:
            # Deduplicate by trade_id (in case API returns duplicates)
            seen_ids = set()
            unique_records = []
            for record in trade_records:
                trade_id = record["trade_id"]
                if trade_id not in seen_ids:
                    seen_ids.add(trade_id)
                    unique_records.append(record)

            try:
                self.supabase.table("wallet_trades").upsert(
                    unique_records, on_conflict="address,trade_id"
                ).execute()
            except Exception as e:
                logger.error(f"Failed to store trades for {address[:10]}...: {e}")
                return 0

            return len(unique_records)

        return 0

    def _calculate_period_metrics(
        self,
        closed_positions: list[dict],
        open_positions: list[dict],
        trades: list[dict],
        days: int
    ) -> dict:
        """
        Calculate metrics for a specific time period (7d or 30d).

        This calculates metrics INDEPENDENTLY for each period:
        - Volume: Sum of all trades EXECUTED within the period
        - Trade Count: Number of trades EXECUTED within the period
        - Realized PnL: Sum of realizedPnl from positions RESOLVED within the period
        - Win Rate: Percentage of positions RESOLVED within the period with positive PnL
        - ROI: realized_pnl / total_invested for positions resolved in period

        Args:
            closed_positions: List of closed position records from API
            open_positions: List of open position records from API
            trades: List of trade records from API
            days: Number of days to include (7 or 30)

        Returns:
            Dict with pnl, roi, win_rate, volume, trade_count
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)
        cutoff_ts = cutoff.timestamp()

        # =====================================================================
        # 1. VOLUME & TRADE COUNT - from trades EXECUTED in this period
        # =====================================================================
        period_trades = []
        total_volume = 0

        for trade in trades:
            timestamp = trade.get("timestamp")
            if timestamp:
                try:
                    if isinstance(timestamp, (int, float)):
                        # Check if timestamp is in milliseconds (> year 2100 in seconds)
                        trade_ts = timestamp / 1000 if timestamp > 4102444800 else timestamp
                    else:
                        trade_ts = datetime.fromisoformat(
                            str(timestamp).replace("Z", "+00:00")
                        ).timestamp()

                    if trade_ts >= cutoff_ts:
                        period_trades.append(trade)
                        # Calculate USD value
                        usd_value = float(trade.get("usdcSize") or 0)
                        if usd_value == 0:
                            size = float(trade.get("size") or 0)
                            price = float(trade.get("price") or 0)
                            usd_value = size * price
                        total_volume += usd_value
                except Exception:
                    pass

        # =====================================================================
        # 2. WIN RATE & REALIZED PNL - from positions RESOLVED in this period
        # =====================================================================
        period_closed = []
        realized_pnl = 0
        total_invested = 0
        winning_count = 0

        for pos in closed_positions:
            # Try multiple possible field names for resolution date
            # API may use: resolvedAt, endDate, or timestamp
            resolved_date = (
                pos.get("resolvedAt") or
                pos.get("endDate") or
                pos.get("timestamp") or
                pos.get("settledAt")
            )

            if resolved_date:
                try:
                    if isinstance(resolved_date, (int, float)):
                        # Check if timestamp is in milliseconds (> year 2100 in seconds)
                        resolved_ts = resolved_date / 1000 if resolved_date > 4102444800 else resolved_date
                    else:
                        resolved_ts = datetime.fromisoformat(
                            str(resolved_date).replace("Z", "+00:00")
                        ).timestamp()

                    if resolved_ts >= cutoff_ts:
                        period_closed.append(pos)
                        # Try multiple field names for PnL
                        pnl = float(pos.get("realizedPnl") or pos.get("cashPnl") or pos.get("pnl") or 0)
                        realized_pnl += pnl

                        # Calculate initial investment - try multiple field names
                        total_bought = float(pos.get("totalBought") or pos.get("size") or 0)
                        avg_price = float(pos.get("avgPrice") or pos.get("buyAvgPrice") or 0)
                        initial_value = float(pos.get("initialValue") or (total_bought * avg_price) or 0)
                        total_invested += initial_value

                        if pnl > 0:
                            winning_count += 1
                except Exception as e:
                    logger.debug(f"Error parsing closed position date: {e}")

        # Win rate for this period
        # Note: If no positions resolved in this period, win_rate will be 0
        total_closed = len(period_closed)
        losing_count = total_closed - winning_count
        win_rate = (winning_count / total_closed * 100) if total_closed > 0 else 0

        # ROI for this period
        roi = (realized_pnl / total_invested * 100) if total_invested > 0 else 0

        return {
            "pnl": round(realized_pnl, 2),
            "roi": round(roi, 2),
            "win_rate": round(win_rate, 2),
            "volume": round(total_volume, 2),
            "trade_count": len(period_trades),
            # Additional detail fields
            "positions_resolved": total_closed,
            "winning_positions": winning_count,
            "losing_positions": losing_count,
        }

    def _calculate_overall_metrics(
        self,
        closed_positions: list[dict],
        open_positions: list[dict],
        trades: list[dict]
    ) -> dict:
        """
        Calculate ALL-TIME metrics from closed positions, open positions, and trade history.

        This matches Polymarket's profile display:
        - Total Positions: count of all closed positions
        - Total Wins: positions with realizedPnl > 0
        - Total Losses: positions with realizedPnl <= 0
        - Overall PnL: sum of all realizedPnl + unrealized PnL from open positions
        - Overall Win Rate: total_wins / total_positions * 100

        Args:
            closed_positions: List of ALL closed position records from API
            open_positions: List of ALL open position records from API
            trades: List of ALL trade records from API

        Returns:
            Dict with overall metrics
        """
        # =====================================================================
        # Calculate ALL-TIME metrics from ALL closed positions
        # =====================================================================
        total_positions = len(closed_positions)
        total_wins = 0
        total_losses = 0
        realized_pnl = 0
        total_invested_closed = 0

        for pos in closed_positions:
            pnl = float(pos.get("realizedPnl", 0))
            realized_pnl += pnl

            # Calculate initial investment
            total_bought = float(pos.get("totalBought", 0))
            avg_price = float(pos.get("avgPrice", 0))
            initial_value = total_bought * avg_price
            total_invested_closed += initial_value

            if pnl > 0:
                total_wins += 1
            else:
                total_losses += 1

        # =====================================================================
        # Calculate unrealized PnL from OPEN positions
        # =====================================================================
        unrealized_pnl = 0
        total_invested_open = 0
        active_positions = len(open_positions)

        for pos in open_positions:
            unrealized_pnl += float(pos.get("cashPnl", 0))
            total_invested_open += float(pos.get("initialValue", 0))

        # Overall PnL = realized + unrealized
        overall_pnl = realized_pnl + unrealized_pnl

        # Overall win rate (all-time, based on closed positions only)
        overall_win_rate = (total_wins / total_positions * 100) if total_positions > 0 else 0

        # Overall ROI (all-time)
        total_invested = total_invested_closed + total_invested_open
        overall_roi = (overall_pnl / total_invested * 100) if total_invested > 0 else 0

        # =====================================================================
        # Calculate ALL-TIME volume from ALL trades
        # =====================================================================
        total_volume = 0
        for trade in trades:
            usd_value = float(trade.get("usdcSize") or 0)
            if usd_value == 0:
                size = float(trade.get("size") or 0)
                price = float(trade.get("price") or 0)
                usd_value = size * price
            total_volume += usd_value

        return {
            "total_positions": total_positions,
            "active_positions": active_positions,
            "total_wins": total_wins,
            "total_losses": total_losses,
            "realized_pnl": round(realized_pnl, 2),
            "unrealized_pnl": round(unrealized_pnl, 2),
            "overall_pnl": round(overall_pnl, 2),
            "overall_roi": round(overall_roi, 2),
            "overall_win_rate": round(overall_win_rate, 2),
            "total_volume": round(total_volume, 2),
            "total_trades": len(trades),
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
            "wallets_discovered": self._wallets_discovered,  # Total $100+ trades seen
            "wallets_processed": self._wallets_processed,    # Actually analyzed
            "trades_stored": self._trades_stored,
            "errors": self._errors,
        }
