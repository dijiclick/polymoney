"""Application settings and configuration loader."""

import os
from pathlib import Path
from typing import Optional
from functools import lru_cache

import yaml
from dotenv import load_dotenv
from pydantic import BaseModel, Field


class SupabaseConfig(BaseModel):
    """Supabase configuration."""
    url: str
    key: str
    anon_key: Optional[str] = None


class PolymarketConfig(BaseModel):
    """Polymarket configuration."""
    private_key: Optional[str] = None
    api_key: Optional[str] = None


class PipelineConfig(BaseModel):
    """Pipeline configuration."""
    parallel_workers: int = 10
    api_rate_limit: int = 60


class PolymarketApiConfig(BaseModel):
    """Polymarket Data API configuration."""
    base_url: str = "https://data-api.polymarket.com"
    rate_limit: int = 60


class GoldskyAnalyticsConfig(BaseModel):
    """Goldsky analytics configuration."""
    enabled: bool = True
    compare_mode: bool = True
    tolerance_pct: float = 1.0


class AnalyticsConfig(BaseModel):
    """Analytics data source configuration."""
    # Data source: "polymarket", "goldsky", or "both"
    data_source: str = "polymarket"
    goldsky: GoldskyAnalyticsConfig = Field(default_factory=GoldskyAnalyticsConfig)


class ApiConfig(BaseModel):
    """API configuration."""
    polymarket: PolymarketApiConfig = Field(default_factory=PolymarketApiConfig)


class Settings(BaseModel):
    """Application settings."""
    supabase: SupabaseConfig
    polymarket: PolymarketConfig
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    api: ApiConfig = Field(default_factory=ApiConfig)
    analytics: AnalyticsConfig = Field(default_factory=AnalyticsConfig)
    platform_wallets: list[str] = Field(default_factory=list)
    config_path: Path = Field(default=Path("config.yaml"))

    @classmethod
    def load(cls, config_path: Optional[Path] = None) -> "Settings":
        """Load settings from environment and config file."""
        load_dotenv()

        config_path = config_path or Path("config.yaml")
        config_data = {}

        if config_path.exists():
            with open(config_path) as f:
                config_data = yaml.safe_load(f) or {}

        # Load from environment
        supabase_config = SupabaseConfig(
            url=os.getenv("SUPABASE_URL", ""),
            key=os.getenv("SUPABASE_KEY", ""),
            anon_key=os.getenv("SUPABASE_ANON_KEY"),
        )

        polymarket_config = PolymarketConfig(
            private_key=os.getenv("POLYMARKET_PRIVATE_KEY"),
            api_key=os.getenv("POLYMARKET_API_KEY"),
        )

        pipeline_config = PipelineConfig(
            parallel_workers=int(os.getenv("PARALLEL_WORKERS", "10")),
            api_rate_limit=int(os.getenv("API_RATE_LIMIT", "60")),
        )

        # Load API config from yaml
        api_data = config_data.get("api", {})
        api_config = ApiConfig(
            polymarket=PolymarketApiConfig(**api_data.get("polymarket", {})),
        )

        # Load analytics config from yaml
        analytics_data = config_data.get("analytics", {})
        goldsky_analytics_data = analytics_data.get("goldsky", {})
        analytics_config = AnalyticsConfig(
            data_source=analytics_data.get("data_source", "polymarket"),
            goldsky=GoldskyAnalyticsConfig(**goldsky_analytics_data),
        )

        return cls(
            supabase=supabase_config,
            polymarket=polymarket_config,
            pipeline=pipeline_config,
            api=api_config,
            analytics=analytics_config,
            platform_wallets=config_data.get("platform_wallets", []),
            config_path=config_path,
        )


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings.load()
