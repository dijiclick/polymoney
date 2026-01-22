#!/usr/bin/env python3
"""Export trader data to CSV."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import click
import pandas as pd
from datetime import datetime

from src.database.queries import TraderQueries
from src.database.supabase import get_supabase_client


@click.command()
@click.option("--profile", type=click.Choice(["copytrade", "bot", "insider", "all"]), default="all",
              help="Which profile to export")
@click.option("--output", "-o", type=click.Path(), help="Output file path")
@click.option("--limit", default=1000, help="Maximum number of traders to export")
@click.option("--min-score", default=60, help="Minimum score threshold")
def export(profile: str, output: str, limit: int, min_score: int):
    """Export traders to CSV file."""
    queries = TraderQueries()

    # Determine output path
    if not output:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = f"data/exports/{profile}_{timestamp}.csv"

    # Ensure output directory exists
    Path(output).parent.mkdir(parents=True, exist_ok=True)

    traders = []

    if profile == "copytrade" or profile == "all":
        copytrade = queries.get_top_copytrade_candidates(limit=limit, min_score=min_score)
        for t in copytrade:
            t["profile"] = "copytrade"
        traders.extend(copytrade)

    if profile == "bot" or profile == "all":
        bots = queries.get_likely_bots(limit=limit, min_score=min_score)
        for t in bots:
            t["profile"] = "bot"
        traders.extend(bots)

    if profile == "insider" or profile == "all":
        insiders = queries.get_insider_suspects(limit=limit, min_score=min_score)
        for t in insiders:
            t["profile"] = "insider"
        traders.extend(insiders)

    if not traders:
        click.echo("No traders found matching criteria")
        return

    # Convert to DataFrame and export
    df = pd.DataFrame(traders)

    # Select relevant columns
    columns = [
        "address", "profile", "portfolio_value", "win_rate_30d", "roi_percent",
        "max_drawdown", "trade_count_30d", "unique_markets_30d",
        "copytrade_score", "bot_score", "insider_score",
        "trade_frequency", "account_age_days", "max_position_size"
    ]

    # Only include columns that exist
    columns = [c for c in columns if c in df.columns]
    df = df[columns]

    df.to_csv(output, index=False)

    click.echo(f"Exported {len(traders)} traders to {output}")


@click.command()
@click.option("--output", "-o", type=click.Path(), help="Output file path")
def export_all(output: str):
    """Export all qualified traders to CSV."""
    db = get_supabase_client()

    if not output:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output = f"data/exports/all_qualified_{timestamp}.csv"

    Path(output).parent.mkdir(parents=True, exist_ok=True)

    traders = db.get_qualified_traders(limit=100000)

    if not traders:
        click.echo("No qualified traders found")
        return

    df = pd.DataFrame(traders)
    df.to_csv(output, index=False)

    click.echo(f"Exported {len(traders)} traders to {output}")


if __name__ == "__main__":
    export()
