#!/usr/bin/env python3
"""Test script to verify Supabase database connection and setup."""

import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import os
os.environ['PYTHONIOENCODING'] = 'utf-8'

from rich.console import Console
from rich.table import Table
from rich.panel import Panel

from src.database.supabase import get_supabase_client
from src.config.settings import get_settings

console = Console()


def test_database_connection():
    """Test database connection and verify tables exist."""
    console.print("\n[bold cyan]Testing Supabase Database Connection...[/bold cyan]")
    
    try:
        settings = get_settings()
        
        if not settings.supabase.url:
            console.print("[red][FAIL] SUPABASE_URL not set in .env file[/red]")
            return False
        
        if not settings.supabase.key:
            console.print("[red][FAIL] SUPABASE_KEY not set in .env file[/red]")
            return False
        
        console.print(f"Supabase URL: {settings.supabase.url[:30]}...")
        console.print("Connecting to database...")
        
        db = get_supabase_client()
        
        # Test connection by trying to query traders table
        console.print("\nTesting connection by querying 'traders' table...")
        try:
            result = db.client.table("traders").select("address", count="exact").limit(1).execute()
            console.print("[green][OK] Database connection successful![/green]")
            console.print(f"  Traders table exists and is accessible")
            
            # Check if table is empty or has data
            count = result.count if hasattr(result, 'count') else 0
            if count is None:
                # Try a different approach
                traders = db.get_traders_by_step(1, limit=1)
                count = len(traders) if traders else 0
            
            console.print(f"  Current traders in database: {count}")
            
            return True
            
        except Exception as e:
            error_msg = str(e)
            if "relation" in error_msg.lower() or "does not exist" in error_msg.lower():
                console.print("[yellow][WARN] Traders table does not exist[/yellow]")
                console.print("  You need to run the database setup script")
                console.print("  See: scripts/setup_database.sql")
                return False
            else:
                console.print(f"[red][FAIL] Database query failed[/red]")
                console.print(f"  Error: {error_msg}")
                return False
        
    except Exception as e:
        console.print(f"[red][FAIL] Database connection failed[/red]")
        console.print(f"  Error: {str(e)}")
        console.print("\n  Make sure:")
        console.print("  1. SUPABASE_URL is set in .env file")
        console.print("  2. SUPABASE_KEY is set in .env file")
        console.print("  3. Database schema has been created (run setup_database.sql)")
        return False


def check_required_tables():
    """Check if all required tables exist."""
    console.print("\n[bold cyan]Checking required tables...[/bold cyan]")
    
    required_tables = [
        "traders",
        "trader_positions",
        "trader_closed_positions",
        "pipeline_runs",
        "watchlist"
    ]
    
    db = get_supabase_client()
    existing_tables = []
    missing_tables = []
    
    for table in required_tables:
        try:
            # Try to query the table
            db.client.table(table).select("*").limit(1).execute()
            existing_tables.append(table)
            console.print(f"  [green][OK][/green] {table}")
        except Exception as e:
            missing_tables.append(table)
            console.print(f"  [red][MISS][/red] {table} (missing)")
    
    if missing_tables:
        console.print(f"\n[yellow]Missing tables: {', '.join(missing_tables)}[/yellow]")
        console.print("  Run scripts/setup_database.sql in Supabase SQL Editor")
        return False
    else:
        console.print(f"\n[green][OK] All required tables exist![/green]")
        return True


def main():
    """Run database tests."""
    console.print("\n[bold blue]=" * 60)
    console.print("[bold blue]Database Connection Test[/bold blue]")
    console.print("[bold blue]=" * 60)
    
    # Test connection
    connection_ok = test_database_connection()
    
    if connection_ok:
        # Check tables
        tables_ok = check_required_tables()
        
        # Summary
        console.print("\n[bold]Summary:[/bold]")
        if connection_ok and tables_ok:
            console.print("[green][OK] Database is ready![/green]")
            console.print("  You can proceed with running the pipeline.")
        elif connection_ok:
            console.print("[yellow][WARN] Database connected but tables are missing[/yellow]")
            console.print("  1. Go to Supabase dashboard")
            console.print("  2. Open SQL Editor")
            console.print("  3. Run scripts/setup_database.sql")
        else:
            console.print("[red][FAIL] Database setup incomplete[/red]")
    else:
        console.print("\n[bold]Summary:[/bold]")
        console.print("[red][FAIL] Cannot connect to database[/red]")
        console.print("  Check your .env file configuration")
    
    console.print("")


if __name__ == "__main__":
    main()
