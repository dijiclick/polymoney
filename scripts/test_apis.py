#!/usr/bin/env python3
"""Test script to verify Goldsky and Polymarket APIs are working."""

import asyncio
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import os
# Fix Windows encoding for Rich
os.environ['PYTHONIOENCODING'] = 'utf-8'

from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich import print as rprint

from src.scrapers.goldsky import GoldskyScraper
from src.scrapers.data_api import PolymarketDataAPI
from src.config.settings import get_settings

console = Console()


async def test_goldsky():
    """Test Goldsky API connection."""
    console.print("\n[bold cyan]Testing Goldsky API...[/bold cyan]")
    
    try:
        settings = get_settings()
        endpoint = settings.api.goldsky.endpoint
        
        console.print(f"Endpoint: {endpoint}")
        
        async with GoldskyScraper() as scraper:
            # Try to fetch a small batch of recent events
            from datetime import datetime, timedelta
            
            now = int(datetime.now().timestamp())
            # Get last 1 hour of data
            one_hour_ago = int((datetime.now() - timedelta(hours=1)).timestamp())
            
            console.print(f"Fetching events from last hour...")
            events = await scraper._fetch_events(
                timestamp_lt=now,
                timestamp_gte=one_hour_ago,
                first=10  # Just get 10 events for testing
            )
            
            if events:
                console.print(f"[green][OK] Goldsky API is working![/green]")
                console.print(f"  Found {len(events)} events in last hour")
                
                # Show sample event
                if len(events) > 0:
                    sample = events[0]
                    console.print(f"\n  Sample event:")
                    console.print(f"    Timestamp: {sample.get('timestamp')}")
                    console.print(f"    Maker: {sample.get('maker', '')[:20]}...")
                    console.print(f"    Taker: {sample.get('taker', '')[:20]}...")
                
                return True, f"Success: Found {len(events)} events"
            else:
                console.print(f"[yellow][WARN] Goldsky API responded but no events found[/yellow]")
                console.print("  This might be normal if there were no trades in the last hour")
                return True, "API working but no recent events"
                
    except Exception as e:
        console.print(f"[red][FAIL] Goldsky API test failed[/red]")
        console.print(f"  Error: {str(e)}")
        return False, str(e)


async def test_polymarket():
    """Test Polymarket Data API connection."""
    console.print("\n[bold cyan]Testing Polymarket Data API...[/bold cyan]")
    
    try:
        settings = get_settings()
        base_url = settings.api.polymarket.base_url
        
        console.print(f"Base URL: {base_url}")
        
        # Use a known test address (you can replace with any valid Polymarket address)
        # Using a common address format - if this doesn't work, we'll catch the error
        test_address = "0x0000000000000000000000000000000000000000"
        
        async with PolymarketDataAPI() as api:
            # Test portfolio value endpoint
            console.print(f"Testing /value endpoint...")
            value = await api.get_portfolio_value(test_address)
            
            # Even if value is 0, the API call succeeded
            console.print(f"[green][OK] Polymarket Data API is working![/green]")
            console.print(f"  Portfolio value for test address: ${value:,.2f}")
            
            # Test positions endpoint
            console.print(f"\n  Testing /positions endpoint...")
            positions = await api.get_positions(test_address)
            console.print(f"  Positions: {len(positions)}")
            
            # Test closed-positions endpoint
            console.print(f"  Testing /closed-positions endpoint...")
            closed = await api.get_closed_positions(test_address)
            console.print(f"  Closed positions: {len(closed)}")
            
            return True, f"Success: All endpoints responding"
            
    except Exception as e:
        console.print(f"[red][FAIL] Polymarket Data API test failed[/red]")
        console.print(f"  Error: {str(e)}")
        
        # Check if it's a 404 (address not found) vs actual API error
        if "404" in str(e) or "not found" in str(e).lower():
            console.print(f"  [yellow]Note: This might be a valid API response (address not found)[/yellow]")
            return True, "API responding (404 is expected for test address)"
        
        return False, str(e)


async def test_with_real_address():
    """Test with a potentially real address from recent Goldsky data."""
    console.print("\n[bold cyan]Testing with real address from Goldsky...[/bold cyan]")
    
    try:
        async with GoldskyScraper() as scraper:
            from datetime import datetime, timedelta
            
            now = int(datetime.now().timestamp())
            one_day_ago = int((datetime.now() - timedelta(days=1)).timestamp())
            
            # Get a few events to find a real address
            events = await scraper._fetch_events(
                timestamp_lt=now,
                timestamp_gte=one_day_ago,
                first=5
            )
            
            if not events:
                console.print("[yellow]No recent events to test with[/yellow]")
                return
            
            # Get first maker address
            test_address = events[0].get("maker", "").lower()
            console.print(f"Testing with address: {test_address[:20]}...")
            
            async with PolymarketDataAPI() as api:
                value = await api.get_portfolio_value(test_address)
                positions = await api.get_positions(test_address)
                closed = await api.get_closed_positions(test_address)
                
                console.print(f"[green][OK] Real address test successful![/green]")
                console.print(f"  Portfolio: ${value:,.2f}")
                console.print(f"  Open positions: {len(positions)}")
                console.print(f"  Closed positions: {len(closed)}")
                
    except Exception as e:
        console.print(f"[yellow]Real address test: {str(e)}[/yellow]")
        console.print("  (This is optional, main API test is what matters)")


async def main():
    """Run all API tests."""
    console.print("\n[bold blue]=" * 60)
    console.print("[bold blue]API Connection Test[/bold blue]")
    console.print("[bold blue]=" * 60)
    
    results = Table(title="Test Results", show_header=True, header_style="bold")
    results.add_column("API", style="cyan")
    results.add_column("Status", style="green")
    results.add_column("Details")
    
    # Test Goldsky
    goldsky_ok, goldsky_msg = await test_goldsky()
    results.add_row(
        "Goldsky",
        "[green][OK] Working[/green]" if goldsky_ok else "[red][FAIL] Failed[/red]",
        goldsky_msg
    )
    
    # Test Polymarket
    polymarket_ok, polymarket_msg = await test_polymarket()
    results.add_row(
        "Polymarket Data API",
        "[green][OK] Working[/green]" if polymarket_ok else "[red][FAIL] Failed[/red]",
        polymarket_msg
    )
    
    # Optional: Test with real address
    try:
        await test_with_real_address()
    except Exception as e:
        console.print(f"[dim]Skipping real address test: {e}[/dim]")
    
    console.print("\n")
    console.print(results)
    
    # Summary
    console.print("\n[bold]Summary:[/bold]")
    if goldsky_ok and polymarket_ok:
        console.print("[green][OK] Both APIs are working correctly![/green]")
        console.print("  You can proceed with running the pipeline.")
    else:
        console.print("[red][FAIL] Some APIs are not working[/red]")
        if not goldsky_ok:
            console.print("  - Check Goldsky endpoint in config.yaml")
            console.print("  - Verify network connection")
        if not polymarket_ok:
            console.print("  - Check Polymarket base URL in config.yaml")
            console.print("  - Verify API is accessible")
    
    console.print("")


if __name__ == "__main__":
    asyncio.run(main())
