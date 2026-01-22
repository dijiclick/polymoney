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


class GoldskyApiConfig(BaseModel):
    """Goldsky API configuration."""
    endpoint: str = "https://api.goldsky.com/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/orderbook-subgraph/0.0.1/gn"
    batch_size: int = 1000
    rate_limit: int = 10


class PolymarketApiConfig(BaseModel):
    """Polymarket Data API configuration."""
    base_url: str = "https://data-api.polymarket.com"
    rate_limit: int = 60


class ApiConfig(BaseModel):
    """API configuration."""
    goldsky: GoldskyApiConfig = Field(default_factory=GoldskyApiConfig)
    polymarket: PolymarketApiConfig = Field(default_factory=PolymarketApiConfig)


class Settings(BaseModel):
    """Application settings."""
    supabase: SupabaseConfig
    polymarket: PolymarketConfig
    pipeline: PipelineConfig = Field(default_factory=PipelineConfig)
    api: ApiConfig = Field(default_factory=ApiConfig)
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
            goldsky=GoldskyApiConfig(**api_data.get("goldsky", {})),
            polymarket=PolymarketApiConfig(**api_data.get("polymarket", {})),
        )

        return cls(
            supabase=supabase_config,
            polymarket=polymarket_config,
            pipeline=pipeline_config,
            api=api_config,
            platform_wallets=config_data.get("platform_wallets", []),
            config_path=config_path,
        )


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings.load()
