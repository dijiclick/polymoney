#!/usr/bin/env python3
"""Initialize database schema in Supabase."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import click
from supabase import create_client

from src.config.settings import get_settings


def get_sql_content() -> str:
    """Read SQL schema file."""
    sql_path = Path(__file__).parent / "setup_database.sql"
    with open(sql_path) as f:
        return f.read()


@click.command()
@click.option("--dry-run", is_flag=True, help="Print SQL without executing")
def setup(dry_run: bool):
    """Initialize the database schema."""
    settings = get_settings()

    if not settings.supabase.url or not settings.supabase.key:
        click.echo("Error: Supabase URL and Key must be set in .env file")
        click.echo("Copy .env.example to .env and fill in your credentials")
        return

    sql_content = get_sql_content()

    if dry_run:
        click.echo("SQL to be executed:")
        click.echo("-" * 50)
        click.echo(sql_content)
        return

    click.echo("Connecting to Supabase...")
    client = create_client(settings.supabase.url, settings.supabase.key)

    # Note: Supabase doesn't support direct SQL execution via the Python client
    # You need to run the SQL directly in the Supabase SQL Editor
    click.echo("\n" + "=" * 60)
    click.echo("IMPORTANT: Supabase requires SQL to be run via the SQL Editor")
    click.echo("=" * 60)
    click.echo("\n1. Go to your Supabase dashboard")
    click.echo("2. Navigate to SQL Editor")
    click.echo("3. Create a new query")
    click.echo("4. Paste the contents of scripts/setup_database.sql")
    click.echo("5. Run the query")
    click.echo("\nThe SQL file is located at: scripts/setup_database.sql")
    click.echo("\nAlternatively, you can copy it to clipboard with:")
    click.echo("  cat scripts/setup_database.sql | clip  (Windows)")
    click.echo("  cat scripts/setup_database.sql | pbcopy  (macOS)")
    click.echo("  cat scripts/setup_database.sql | xclip  (Linux)")


if __name__ == "__main__":
    setup()
