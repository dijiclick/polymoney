"""
Metrics calculator for wallet analytics.

Recalculates 7d and 30d metrics for all wallets from wallet_trades table.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Callable

from ..database.supabase import get_supabase_client, SupabaseClient

logger = logging.getLogger(__name__)


class MetricsCalculator:
    """
    Recalculates wallet metrics from trade history.

    Calculates:
    - PnL (7d and 30d)
    - ROI (7d and 30d)
    - Win Rate (7d and 30d)
    - Volume (7d and 30d)
    - Trade Count (7d and 30d)
    """

    def __init__(self):
        self.db: SupabaseClient = get_supabase_client()

    async def update_all_metrics(
        self,
        progress_callback: Optional[Callable[[int, int], None]] = None
    ) -> dict:
        """
        Update metrics for all wallets with trades.

        Args:
            progress_callback: Optional callback(processed, total)

        Returns:
            Summary dict with counts
        """
        # Get all wallets
        wallets = self.db.get_all_wallets(limit=50000)

        if not wallets:
            return {
                "total": 0,
                "updated": 0,
                "skipped": 0,
                "errors": 0,
            }

        total = len(wallets)
        updated = 0
        skipped = 0
        errors = 0

        logger.info(f"Calculating metrics for {total} wallets...")

        for i, wallet in enumerate(wallets):
            try:
                address = wallet["address"]

                # Get trades for this wallet (last 30 days covers both 7d and 30d)
                trades = self.db.get_wallet_trades(address, days=30)

                if not trades:
                    skipped += 1
                    continue

                # Calculate metrics for both periods
                metrics_7d = self._calculate_metrics(trades, days=7)
                metrics_30d = self._calculate_metrics(trades, days=30)

                # Update wallet with metrics
                update_data = {
                    "pnl_7d": metrics_7d["pnl"],
                    "pnl_30d": metrics_30d["pnl"],
                    "roi_7d": metrics_7d["roi"],
                    "roi_30d": metrics_30d["roi"],
                    "win_rate_7d": metrics_7d["win_rate"],
                    "win_rate_30d": metrics_30d["win_rate"],
                    "volume_7d": metrics_7d["volume"],
                    "volume_30d": metrics_30d["volume"],
                    "trade_count_7d": metrics_7d["trade_count"],
                    "trade_count_30d": metrics_30d["trade_count"],
                    "metrics_updated_at": datetime.now(timezone.utc).isoformat(),
                }

                self.db.update_wallet(address, update_data)
                updated += 1

                if progress_callback and (i + 1) % 10 == 0:
                    progress_callback(i + 1, total)

            except Exception as e:
                logger.error(f"Error calculating metrics for {wallet.get('address', 'unknown')}: {e}")
                errors += 1

        logger.info(f"Metrics update complete: {updated} updated, {skipped} skipped, {errors} errors")

        return {
            "total": total,
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
        }

    def _calculate_metrics(self, trades: list[dict], days: int) -> dict:
        """
        Calculate metrics from trade history.

        Args:
            trades: List of trade records from wallet_trades table
            days: Number of days to include (7 or 30)

        Returns:
            Dict with pnl, roi, win_rate, volume, trade_count
        """
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(days=days)

        # Filter trades to time period
        period_trades = []
        for trade in trades:
            executed_at_str = trade.get("executed_at")
            if executed_at_str:
                try:
                    executed_at = datetime.fromisoformat(executed_at_str.replace("Z", "+00:00"))
                    if executed_at >= cutoff:
                        period_trades.append(trade)
                except Exception:
                    pass

        if not period_trades:
            return {
                "pnl": 0,
                "roi": 0,
                "win_rate": 0,
                "volume": 0,
                "trade_count": 0,
            }

        # Group by market (condition_id)
        market_trades: dict[str, list[dict]] = {}
        for trade in period_trades:
            condition_id = trade.get("condition_id") or "unknown"
            if condition_id not in market_trades:
                market_trades[condition_id] = []
            market_trades[condition_id].append(trade)

        # Calculate per-market PnL and overall metrics
        total_pnl = 0
        total_invested = 0
        total_volume = 0
        winning_markets = 0
        closed_markets = 0

        for market_id, m_trades in market_trades.items():
            market_pnl = 0

            for t in m_trades:
                usd_value = float(t.get("usd_value") or 0)
                total_volume += usd_value
                side = t.get("side", "").upper()

                if side == "SELL":
                    market_pnl += usd_value
                else:  # BUY
                    market_pnl -= usd_value
                    total_invested += usd_value

            total_pnl += market_pnl

            # Only count markets with both buys and sells as "closed"
            has_buy = any(t.get("side", "").upper() == "BUY" for t in m_trades)
            has_sell = any(t.get("side", "").upper() == "SELL" for t in m_trades)

            if has_buy and has_sell:
                closed_markets += 1
                if market_pnl > 0:
                    winning_markets += 1

        # Calculate final metrics
        roi = (total_pnl / total_invested * 100) if total_invested > 0 else 0
        win_rate = (winning_markets / closed_markets * 100) if closed_markets > 0 else 0

        return {
            "pnl": round(total_pnl, 2),
            "roi": round(roi, 2),
            "win_rate": round(win_rate, 2),
            "volume": round(total_volume, 2),
            "trade_count": len(period_trades),
        }

    def calculate_wallet_metrics(self, address: str) -> dict:
        """
        Calculate metrics for a single wallet.

        Args:
            address: Wallet address

        Returns:
            Dict with 7d and 30d metrics
        """
        trades = self.db.get_wallet_trades(address, days=30)

        metrics_7d = self._calculate_metrics(trades, days=7)
        metrics_30d = self._calculate_metrics(trades, days=30)

        return {
            "7d": metrics_7d,
            "30d": metrics_30d,
        }
