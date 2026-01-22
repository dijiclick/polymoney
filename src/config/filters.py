"""Filter configuration for trader classification."""

from pathlib import Path
from typing import Any, Optional

import yaml
from pydantic import BaseModel, Field


class GlobalFilters(BaseModel):
    """Global filters applied to all profiles."""
    min_trades_30d: int = 10
    min_portfolio_value: float = 200
    min_position_size: float = 10
    exclude_platform_wallets: bool = True


class Step1Filters(BaseModel):
    """Step 1: Goldsky extraction filters."""
    min_trades: int = 10


class Step2Filters(BaseModel):
    """Step 2: Balance check filters."""
    min_portfolio_value: float = 200


class Step3Filters(BaseModel):
    """Step 3: Positions analysis filters."""
    min_position_size: float = 10
    require_positions: bool = False


class Step4Filters(BaseModel):
    """Step 4: Performance filters."""
    min_win_rate: float = 40
    min_total_pnl: float = 0
    require_one: bool = True


class PipelineFilters(BaseModel):
    """Pipeline step filters."""
    step1_goldsky: Step1Filters = Field(default_factory=Step1Filters)
    step2_balance: Step2Filters = Field(default_factory=Step2Filters)
    step3_positions: Step3Filters = Field(default_factory=Step3Filters)
    step4_performance: Step4Filters = Field(default_factory=Step4Filters)


class CopytradeFilters(BaseModel):
    """Copy trade profile filters."""
    min_win_rate_30d: float = 60
    min_account_age_days: int = 60
    max_drawdown: float = 30
    min_unique_markets: int = 5
    min_portfolio_value: float = 500
    trade_frequency_range: list[float] = Field(default=[0.5, 5])


class BotFilters(BaseModel):
    """Bot profile filters."""
    min_trades_30d: int = 100
    min_win_rate_30d: float = 55
    max_drawdown: float = 20
    min_portfolio_value: float = 1000
    min_trade_frequency: float = 10


class InsiderFilters(BaseModel):
    """Insider profile filters."""
    min_max_position_size: float = 5000
    min_position_concentration: float = 50
    max_account_age_days: int = 30
    max_unique_markets: int = 3


class ProfileConfig(BaseModel):
    """Profile-specific configuration."""
    enabled: bool = True
    min_score: int = 60
    filters: dict[str, Any] = Field(default_factory=dict)


class ProfilesConfig(BaseModel):
    """All profile configurations."""
    copytrade: ProfileConfig = Field(default_factory=ProfileConfig)
    bot: ProfileConfig = Field(default_factory=ProfileConfig)
    insider: ProfileConfig = Field(default_factory=ProfileConfig)


class AdvancedFilters(BaseModel):
    """Advanced filter options."""
    categories: dict[str, list[str]] = Field(default_factory=lambda: {"include": [], "exclude": []})
    time_filters: dict[str, Any] = Field(default_factory=lambda: {"only_recent_activity": True, "max_days_since_trade": 7})
    performance_filters: dict[str, Any] = Field(default_factory=lambda: {"min_roi_30d": None, "max_losing_streak": None})


class FilterConfig(BaseModel):
    """Complete filter configuration."""
    global_filters: GlobalFilters = Field(default_factory=GlobalFilters, alias="global")
    pipeline: PipelineFilters = Field(default_factory=PipelineFilters)
    profiles: ProfilesConfig = Field(default_factory=ProfilesConfig)
    advanced: AdvancedFilters = Field(default_factory=AdvancedFilters)

    class Config:
        populate_by_name = True

    @classmethod
    def load(cls, config_path: Optional[Path] = None) -> "FilterConfig":
        """Load filter configuration from YAML file."""
        config_path = config_path or Path("config.yaml")

        if not config_path.exists():
            return cls()

        with open(config_path) as f:
            data = yaml.safe_load(f) or {}

        return cls(
            global_filters=GlobalFilters(**data.get("global", {})),
            pipeline=PipelineFilters(
                step1_goldsky=Step1Filters(**data.get("pipeline", {}).get("step1_goldsky", {})),
                step2_balance=Step2Filters(**data.get("pipeline", {}).get("step2_balance", {})),
                step3_positions=Step3Filters(**data.get("pipeline", {}).get("step3_positions", {})),
                step4_performance=Step4Filters(**data.get("pipeline", {}).get("step4_performance", {})),
            ),
            profiles=ProfilesConfig(
                copytrade=ProfileConfig(**data.get("profiles", {}).get("copytrade", {})),
                bot=ProfileConfig(**data.get("profiles", {}).get("bot", {})),
                insider=ProfileConfig(**data.get("profiles", {}).get("insider", {})),
            ),
            advanced=AdvancedFilters(**data.get("advanced", {})),
        )
