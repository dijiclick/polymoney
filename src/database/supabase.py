"""Supabase client wrapper."""

from functools import lru_cache
from typing import Any, Optional

from supabase import create_client, Client

from ..config.settings import get_settings


class SupabaseClient:
    """Wrapper for Supabase client operations."""

    def __init__(self, client: Client):
        self._client = client

    @property
    def client(self) -> Client:
        """Get the underlying Supabase client."""
        return self._client

    # =========================================================================
    # Trader Operations
    # =========================================================================

    def upsert_trader(self, trader_data: dict) -> dict:
        """Insert or update a trader record."""
        result = self._client.table("traders").upsert(
            trader_data,
            on_conflict="address"
        ).execute()
        return result.data[0] if result.data else {}

    def upsert_traders_batch(self, traders: list[dict]) -> list[dict]:
        """Batch upsert traders."""
        if not traders:
            return []
        result = self._client.table("traders").upsert(
            traders,
            on_conflict="address"
        ).execute()
        return result.data or []

    def get_trader(self, address: str) -> Optional[dict]:
        """Get a trader by address."""
        result = self._client.table("traders").select("*").eq("address", address).execute()
        return result.data[0] if result.data else None

    def get_traders_by_step(self, step: int, limit: int = 1000, offset: int = 0) -> list[dict]:
        """Get traders at a specific pipeline step."""
        result = (
            self._client.table("traders")
            .select("*")
            .eq("pipeline_step", step)
            .is_("eliminated_at_step", "null")
            .range(offset, offset + limit - 1)
            .execute()
        )
        return result.data or []

    def get_qualified_traders(self, profile: Optional[str] = None, limit: int = 100) -> list[dict]:
        """Get qualified traders, optionally filtered by profile."""
        query = (
            self._client.table("traders")
            .select("*")
            .is_("eliminated_at_step", "null")
            .eq("pipeline_step", 6)
        )

        if profile == "copytrade":
            query = query.gte("copytrade_score", 60).order("copytrade_score", desc=True)
        elif profile == "bot":
            query = query.gte("bot_score", 60).order("bot_score", desc=True)
        elif profile == "insider":
            query = query.gte("insider_score", 60).order("insider_score", desc=True)
        else:
            query = query.order("portfolio_value", desc=True)

        result = query.limit(limit).execute()
        return result.data or []

    def update_trader_step(self, address: str, step: int, data: Optional[dict] = None) -> dict:
        """Update trader's pipeline step and optionally other data."""
        update_data = {"pipeline_step": step}
        if data:
            update_data.update(data)
        result = self._client.table("traders").update(update_data).eq("address", address).execute()
        return result.data[0] if result.data else {}

    def eliminate_trader(self, address: str, step: int, reason: str) -> dict:
        """Mark a trader as eliminated at a specific step."""
        result = (
            self._client.table("traders")
            .update({
                "eliminated_at_step": step,
                "elimination_reason": reason
            })
            .eq("address", address)
            .execute()
        )
        return result.data[0] if result.data else {}

    def count_traders_by_step(self) -> dict[int, int]:
        """Get count of traders at each pipeline step."""
        counts = {}
        for step in range(1, 7):
            result = (
                self._client.table("traders")
                .select("address", count="exact")
                .eq("pipeline_step", step)
                .is_("eliminated_at_step", "null")
                .execute()
            )
            counts[step] = result.count or 0
        return counts

    # =========================================================================
    # Position Operations
    # =========================================================================

    def upsert_positions(self, positions: list[dict]) -> list[dict]:
        """Batch upsert positions."""
        if not positions:
            return []
        result = self._client.table("trader_positions").upsert(
            positions,
            on_conflict="address,condition_id,outcome_index"
        ).execute()
        return result.data or []

    def upsert_closed_positions(self, positions: list[dict]) -> list[dict]:
        """Batch upsert closed positions."""
        if not positions:
            return []
        result = self._client.table("trader_closed_positions").upsert(
            positions,
            on_conflict="address,condition_id,outcome"
        ).execute()
        return result.data or []

    def get_positions(self, address: str) -> list[dict]:
        """Get all open positions for a trader."""
        result = (
            self._client.table("trader_positions")
            .select("*")
            .eq("address", address)
            .execute()
        )
        return result.data or []

    def get_closed_positions(self, address: str) -> list[dict]:
        """Get all closed positions for a trader."""
        result = (
            self._client.table("trader_closed_positions")
            .select("*")
            .eq("address", address)
            .execute()
        )
        return result.data or []

    # =========================================================================
    # Pipeline Run Operations
    # =========================================================================

    def create_pipeline_run(self, run_data: dict) -> dict:
        """Create a new pipeline run record."""
        result = self._client.table("pipeline_runs").insert(run_data).execute()
        return result.data[0] if result.data else {}

    def update_pipeline_run(self, run_id: int, data: dict) -> dict:
        """Update a pipeline run record."""
        result = self._client.table("pipeline_runs").update(data).eq("id", run_id).execute()
        return result.data[0] if result.data else {}

    def get_latest_pipeline_run(self) -> Optional[dict]:
        """Get the most recent pipeline run."""
        result = (
            self._client.table("pipeline_runs")
            .select("*")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
        return result.data[0] if result.data else None

    # =========================================================================
    # Watchlist Operations
    # =========================================================================

    def add_to_watchlist(self, address: str, list_type: str, notes: Optional[str] = None) -> dict:
        """Add a trader to watchlist."""
        result = self._client.table("watchlist").upsert({
            "address": address,
            "list_type": list_type,
            "notes": notes
        }, on_conflict="address,list_type").execute()
        return result.data[0] if result.data else {}

    def get_watchlist(self, list_type: Optional[str] = None) -> list[dict]:
        """Get watchlist entries."""
        query = self._client.table("watchlist").select("*, traders(*)")
        if list_type:
            query = query.eq("list_type", list_type)
        result = query.execute()
        return result.data or []

    # =========================================================================
    # Wallet Operations
    # =========================================================================

    def get_wallet(self, address: str) -> Optional[dict]:
        """Get a wallet by address."""
        result = self._client.table("wallets").select("*").eq("address", address.lower()).execute()
        return result.data[0] if result.data else None

    def get_all_wallets(self, limit: int = 10000) -> list[dict]:
        """Get all wallets."""
        result = self._client.table("wallets").select("*").limit(limit).execute()
        return result.data or []

    def get_wallets_by_source(self, source: str) -> list[dict]:
        """Get wallets by source (goldsky, leaderboard, both)."""
        if source == "both":
            result = self._client.table("wallets").select("*").eq("source", source).execute()
        else:
            # Include 'both' when filtering by specific source
            result = (
                self._client.table("wallets")
                .select("*")
                .or_(f"source.eq.{source},source.eq.both")
                .execute()
            )
        return result.data or []

    def get_qualified_wallets(self, min_balance: float = 200) -> list[dict]:
        """Get wallets with balance >= min_balance."""
        result = (
            self._client.table("wallets")
            .select("*")
            .gte("balance", min_balance)
            .order("balance", desc=True)
            .execute()
        )
        return result.data or []

    def get_qualified_wallets_by_source(self, source: str, min_balance: float = 200) -> list[dict]:
        """Get qualified wallets filtered by source."""
        query = self._client.table("wallets").select("*").gte("balance", min_balance)

        if source == "both":
            query = query.eq("source", source)
        else:
            query = query.or_(f"source.eq.{source},source.eq.both")

        result = query.order("balance", desc=True).execute()
        return result.data or []

    def get_stale_wallets(self, hours: int = 24) -> list[dict]:
        """Get wallets not updated in the last N hours."""
        from datetime import datetime, timedelta
        cutoff = (datetime.utcnow() - timedelta(hours=hours)).isoformat()

        result = (
            self._client.table("wallets")
            .select("*")
            .or_(f"balance_updated_at.is.null,balance_updated_at.lt.{cutoff}")
            .execute()
        )
        return result.data or []

    def upsert_wallet(self, wallet_data: dict) -> dict:
        """Insert or update a wallet record."""
        wallet_data["address"] = wallet_data["address"].lower()
        result = self._client.table("wallets").upsert(
            wallet_data,
            on_conflict="address"
        ).execute()
        return result.data[0] if result.data else {}

    def update_wallet(self, address: str, data: dict) -> dict:
        """Update a wallet record."""
        result = (
            self._client.table("wallets")
            .update(data)
            .eq("address", address.lower())
            .execute()
        )
        return result.data[0] if result.data else {}

    # =========================================================================
    # Wallet Leaderboard Rankings
    # =========================================================================

    def upsert_leaderboard_ranking(self, ranking_data: dict) -> dict:
        """Insert a leaderboard ranking record."""
        ranking_data["address"] = ranking_data["address"].lower()
        result = self._client.table("wallet_leaderboard_rankings").insert(ranking_data).execute()
        return result.data[0] if result.data else {}

    def get_wallet_rankings(self, address: str) -> list[dict]:
        """Get all leaderboard rankings for a wallet."""
        result = (
            self._client.table("wallet_leaderboard_rankings")
            .select("*")
            .eq("address", address.lower())
            .order("fetched_at", desc=True)
            .execute()
        )
        return result.data or []

    def get_rankings_by_category(self, category: str, limit: int = 50) -> list[dict]:
        """Get top rankings for a category."""
        result = (
            self._client.table("wallet_leaderboard_rankings")
            .select("*, wallets(*)")
            .eq("category", category)
            .order("rank", desc=False)
            .limit(limit)
            .execute()
        )
        return result.data or []

    # =========================================================================
    # Wallet Trades
    # =========================================================================

    def upsert_wallet_trade(self, trade_data: dict) -> dict:
        """Insert or update a wallet trade record."""
        trade_data["address"] = trade_data["address"].lower()
        result = self._client.table("wallet_trades").upsert(
            trade_data,
            on_conflict="address,trade_id"
        ).execute()
        return result.data[0] if result.data else {}

    def get_wallet_trades(self, address: str, days: Optional[int] = None) -> list[dict]:
        """Get trades for a wallet, optionally filtered by days."""
        query = (
            self._client.table("wallet_trades")
            .select("*")
            .eq("address", address.lower())
        )

        if days:
            from datetime import datetime, timedelta
            cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
            query = query.gte("executed_at", cutoff)

        result = query.order("executed_at", desc=True).execute()
        return result.data or []

    def delete_wallet_trades(self, address: str) -> bool:
        """Delete all trades for a wallet."""
        try:
            self._client.table("wallet_trades").delete().eq("address", address.lower()).execute()
            return True
        except Exception:
            return False

    def get_wallet_trade_stats(self) -> dict:
        """Get aggregate statistics about wallet trades."""
        result = self._client.table("wallet_trades").select("address", count="exact").execute()
        total_trades = result.count or 0

        result = self._client.table("wallet_trades").select("address").execute()
        unique_wallets = len(set(t["address"] for t in result.data)) if result.data else 0

        return {
            "total_trades": total_trades,
            "unique_wallets_with_trades": unique_wallets
        }

    # =========================================================================
    # Raw Query Operations
    # =========================================================================

    def execute_sql(self, sql: str) -> Any:
        """Execute raw SQL (for setup/migration only)."""
        return self._client.rpc("exec_sql", {"query": sql}).execute()


@lru_cache()
def get_supabase_client() -> SupabaseClient:
    """Get cached Supabase client instance."""
    settings = get_settings()
    client = create_client(settings.supabase.url, settings.supabase.key)
    return SupabaseClient(client)
