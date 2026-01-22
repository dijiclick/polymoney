"""Data models for traders and positions."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class Trader(BaseModel):
    """Trader data model."""
    address: str
    username: Optional[str] = None
    profile_image: Optional[str] = None
    first_seen_at: Optional[datetime] = None
    last_updated_at: Optional[datetime] = None

    # Step 1: Goldsky Data
    trade_count_30d: int = 0
    trade_count_alltime: int = 0
    last_trade_at: Optional[datetime] = None
    first_trade_at: Optional[datetime] = None
    account_age_days: Optional[int] = None

    # Step 2: Balance Data
    portfolio_value: float = 0

    # Step 3: Position Data
    total_positions: int = 0
    active_positions: int = 0
    avg_position_size: float = 0
    max_position_size: float = 0
    position_concentration: float = 0

    # Step 4: Performance Data
    closed_positions_30d: int = 0
    winning_positions_30d: int = 0
    win_rate_30d: float = 0
    closed_positions_alltime: int = 0
    winning_positions_alltime: int = 0
    win_rate_alltime: float = 0
    total_pnl: float = 0
    realized_pnl: float = 0
    unrealized_pnl: float = 0
    total_invested: float = 0
    roi_percent: float = 0

    # Step 5: Advanced Metrics
    max_drawdown: float = 0
    trade_frequency: float = 0
    unique_markets_30d: int = 0
    trade_time_variance_hours: Optional[float] = None
    night_trade_ratio: float = 0
    position_size_variance: Optional[float] = None
    avg_hold_duration_hours: Optional[float] = None
    avg_entry_probability: Optional[float] = None
    pnl_concentration: Optional[float] = None
    category_concentration: Optional[str] = None

    # Step 6: Classification Scores
    copytrade_score: int = 0
    bot_score: int = 0
    insider_score: int = 0
    primary_classification: Optional[str] = None

    # Pipeline Tracking
    pipeline_step: int = 1
    eliminated_at_step: Optional[int] = None
    elimination_reason: Optional[str] = None

    # Metadata
    is_platform_wallet: bool = False
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for database insertion."""
        data = self.model_dump(exclude_none=True)
        # Convert datetime to ISO format strings
        for key in ["first_seen_at", "last_updated_at", "last_trade_at", "first_trade_at", "created_at"]:
            if key in data and data[key]:
                data[key] = data[key].isoformat()
        return data


class TraderPosition(BaseModel):
    """Open position model."""
    id: Optional[int] = None
    address: str
    condition_id: Optional[str] = None
    market_slug: Optional[str] = None
    market_title: Optional[str] = None
    event_slug: Optional[str] = None
    category: Optional[str] = None
    outcome: Optional[str] = None
    outcome_index: Optional[int] = None
    size: float = 0
    avg_price: float = 0
    current_price: float = 0
    initial_value: float = 0
    current_value: float = 0
    pnl: float = 0
    pnl_percent: float = 0
    end_date: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for database insertion."""
        data = self.model_dump(exclude_none=True)
        if "id" in data:
            del data["id"]
        for key in ["end_date", "updated_at"]:
            if key in data and data[key]:
                data[key] = data[key].isoformat()
        return data


class TraderClosedPosition(BaseModel):
    """Closed/resolved position model."""
    id: Optional[int] = None
    address: str
    condition_id: Optional[str] = None
    market_slug: Optional[str] = None
    market_title: Optional[str] = None
    outcome: Optional[str] = None
    avg_price: float = 0
    total_bought: float = 0
    final_price: float = 0
    realized_pnl: float = 0
    is_win: bool = False
    resolved_at: Optional[datetime] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for database insertion."""
        data = self.model_dump(exclude_none=True)
        if "id" in data:
            del data["id"]
        if "resolved_at" in data and data["resolved_at"]:
            data["resolved_at"] = data["resolved_at"].isoformat()
        return data


class PipelineRun(BaseModel):
    """Pipeline execution tracking model."""
    id: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    status: str = "running"
    addresses_found: int = 0
    addresses_processed: int = 0
    step1_passed: int = 0
    step2_passed: int = 0
    step3_passed: int = 0
    step4_passed: int = 0
    step5_passed: int = 0
    final_qualified: int = 0
    copytrade_found: int = 0
    bot_found: int = 0
    insider_found: int = 0
    api_calls_made: int = 0
    errors_count: int = 0
    duration_seconds: Optional[int] = None
    error_log: Optional[str] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for database insertion."""
        data = self.model_dump(exclude_none=True)
        if "id" in data:
            del data["id"]
        for key in ["started_at", "completed_at"]:
            if key in data and data[key]:
                data[key] = data[key].isoformat()
        return data
