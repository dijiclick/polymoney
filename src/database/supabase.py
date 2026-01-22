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
