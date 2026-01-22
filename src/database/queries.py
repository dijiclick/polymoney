"""Common database queries for traders."""

from typing import Any, Optional
from .supabase import get_supabase_client


class TraderQueries:
    """Collection of common trader queries."""

    def __init__(self):
        self.db = get_supabase_client()

    def get_top_copytrade_candidates(self, limit: int = 50, min_score: int = 60) -> list[dict]:
        """Get top copy trade candidates."""
        result = (
            self.db.client.table("traders")
            .select("address, username, portfolio_value, win_rate_30d, win_rate_alltime, "
                   "roi_percent, max_drawdown, trade_count_30d, unique_markets_30d, "
                   "copytrade_score, account_age_days")
            .gte("copytrade_score", min_score)
            .is_("eliminated_at_step", "null")
            .order("copytrade_score", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def get_likely_bots(self, limit: int = 50, min_score: int = 60) -> list[dict]:
        """Get likely bots."""
        result = (
            self.db.client.table("traders")
            .select("address, username, portfolio_value, win_rate_30d, trade_count_30d, "
                   "trade_frequency, night_trade_ratio, trade_time_variance_hours, bot_score")
            .gte("bot_score", min_score)
            .is_("eliminated_at_step", "null")
            .order("bot_score", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def get_insider_suspects(self, limit: int = 50, min_score: int = 60) -> list[dict]:
        """Get insider suspects."""
        result = (
            self.db.client.table("traders")
            .select("address, username, portfolio_value, max_position_size, "
                   "position_concentration, avg_entry_probability, account_age_days, "
                   "unique_markets_30d, insider_score")
            .gte("insider_score", min_score)
            .is_("eliminated_at_step", "null")
            .order("insider_score", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def custom_filter(self, filters: dict[str, Any], limit: int = 100) -> list[dict]:
        """Apply custom filters to find traders."""
        query = (
            self.db.client.table("traders")
            .select("*")
            .is_("eliminated_at_step", "null")
        )

        # Apply filters
        for key, value in filters.items():
            if key.startswith("min_"):
                field = key[4:]
                query = query.gte(field, value)
            elif key.startswith("max_"):
                field = key[4:]
                query = query.lte(field, value)
            elif key == "category":
                query = query.eq("category_concentration", value)
            else:
                query = query.eq(key, value)

        result = query.limit(limit).execute()
        return result.data or []

    def get_recently_active(self, days: int = 7, limit: int = 100) -> list[dict]:
        """Get traders active in the last N days."""
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()

        result = (
            self.db.client.table("traders")
            .select("*")
            .gte("last_trade_at", cutoff)
            .is_("eliminated_at_step", "null")
            .order("last_trade_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def get_high_performers(
        self,
        min_win_rate: float = 60,
        min_roi: float = 20,
        min_trades: int = 20,
        limit: int = 50
    ) -> list[dict]:
        """Get high-performing traders."""
        result = (
            self.db.client.table("traders")
            .select("*")
            .gte("win_rate_30d", min_win_rate)
            .gte("roi_percent", min_roi)
            .gte("trade_count_30d", min_trades)
            .is_("eliminated_at_step", "null")
            .order("total_pnl", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def get_whales(self, min_portfolio: float = 10000, limit: int = 50) -> list[dict]:
        """Get traders with large portfolios."""
        result = (
            self.db.client.table("traders")
            .select("*")
            .gte("portfolio_value", min_portfolio)
            .is_("eliminated_at_step", "null")
            .order("portfolio_value", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def search_by_address(self, address_pattern: str) -> list[dict]:
        """Search traders by address pattern."""
        result = (
            self.db.client.table("traders")
            .select("*")
            .ilike("address", f"%{address_pattern}%")
            .limit(20)
            .execute()
        )
        return result.data or []

    def get_statistics(self) -> dict:
        """Get overall statistics."""
        total_result = self.db.client.table("traders").select("*", count="exact").execute()
        qualified_result = (
            self.db.client.table("traders")
            .select("*", count="exact")
            .is_("eliminated_at_step", "null")
            .eq("pipeline_step", 6)
            .execute()
        )

        copytrade_result = (
            self.db.client.table("traders")
            .select("*", count="exact")
            .gte("copytrade_score", 60)
            .is_("eliminated_at_step", "null")
            .execute()
        )

        bot_result = (
            self.db.client.table("traders")
            .select("*", count="exact")
            .gte("bot_score", 60)
            .is_("eliminated_at_step", "null")
            .execute()
        )

        insider_result = (
            self.db.client.table("traders")
            .select("*", count="exact")
            .gte("insider_score", 60)
            .is_("eliminated_at_step", "null")
            .execute()
        )

        return {
            "total_traders": total_result.count or 0,
            "qualified_traders": qualified_result.count or 0,
            "copytrade_candidates": copytrade_result.count or 0,
            "likely_bots": bot_result.count or 0,
            "insider_suspects": insider_result.count or 0,
        }
