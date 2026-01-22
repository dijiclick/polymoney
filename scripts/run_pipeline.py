#!/usr/bin/env python3
"""Main CLI for running the Polymarket Profile Finder pipeline."""

import asyncio
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent))

import click
from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TaskProgressColumn, TimeElapsedColumn
from rich.table import Table
from rich.layout import Layout
from rich.text import Text

from src.pipeline.runner import PipelineRunner
from src.database.queries import TraderQueries
from src.config.filters import FilterConfig
from src.utils.logging import setup_logging


console = Console()


# Step definitions for the dashboard
STEP_NAMES = {
    1: "Goldsky Extraction",
    2: "Balance Check",
    3: "Position Analysis",
    4: "Win Rate Calc",
    5: "Deep Analysis",
    6: "Classification",
}


@dataclass
class StepResult:
    """Result from a completed step."""
    step_num: int
    name: str
    status: str  # "done", "running", "pending"
    qualified: int = 0
    eliminated: int = 0


@dataclass
class DashboardState:
    """Track metrics across pipeline steps."""
    current_step: int = 1
    step_name: str = ""
    processed: int = 0
    total: int = 0
    qualified: int = 0
    eliminated: int = 0
    start_time: float = field(default_factory=time.time)
    step_start_time: float = field(default_factory=time.time)
    step_results: list = field(default_factory=list)
    activity_log: deque = field(default_factory=lambda: deque(maxlen=5))

    def reset_for_step(self, step_num: int, step_name: str):
        """Reset counters for a new step."""
        self.current_step = step_num
        self.step_name = step_name
        self.processed = 0
        self.total = 0
        self.qualified = 0
        self.eliminated = 0
        self.step_start_time = time.time()

    def complete_step(self):
        """Mark current step as complete and save result."""
        self.step_results.append(StepResult(
            step_num=self.current_step,
            name=self.step_name,
            status="done",
            qualified=self.qualified,
            eliminated=self.eliminated,
        ))

    def get_rate(self) -> float:
        """Calculate processing rate (items/sec)."""
        elapsed = time.time() - self.step_start_time
        if elapsed > 0 and self.processed > 0:
            return self.processed / elapsed
        return 0.0

    def get_eta(self) -> Optional[int]:
        """Estimate time remaining in seconds."""
        rate = self.get_rate()
        if rate > 0 and self.total > self.processed:
            return int((self.total - self.processed) / rate)
        return None

    def get_elapsed(self) -> int:
        """Get elapsed time for current step in seconds."""
        return int(time.time() - self.step_start_time)

    def get_total_elapsed(self) -> int:
        """Get total elapsed time in seconds."""
        return int(time.time() - self.start_time)


def render_dashboard(state: DashboardState) -> Panel:
    """Render the full dashboard panel."""
    # Header section
    header = Text()
    header.append("POLYMARKET PIPELINE\n", style="bold blue")
    header.append(f"Step {state.current_step}/6: {state.step_name}", style="cyan")

    # Progress section
    progress_lines = []

    # Progress bar (using ASCII-safe characters for Windows compatibility)
    if state.total > 0:
        pct = (state.processed / state.total) * 100
        filled = int(pct / 5)  # 20 chars total
        bar = "#" * filled + "-" * (20 - filled)
        progress_lines.append(f"[{bar}]  {pct:5.1f}%  ({state.processed:,} / {state.total:,})")
    else:
        progress_lines.append("[" + "-" * 20 + "]  Initializing...")

    # Rate, ETA, Elapsed
    rate = state.get_rate()
    eta = state.get_eta()
    elapsed = state.get_elapsed()

    stats_line = f"Rate: {rate:.1f}/sec  |  "
    if eta is not None:
        stats_line += f"ETA: {eta}s  |  "
    else:
        stats_line += "ETA: --  |  "
    stats_line += f"Elapsed: {elapsed}s"
    progress_lines.append(stats_line)

    # Qualified/Eliminated counts (ASCII-safe)
    progress_lines.append(f"+ Qualified: {state.qualified:,}   - Eliminated: {state.eliminated:,}")

    # Step summary table
    step_table = Table(show_header=True, header_style="bold", box=None, padding=(0, 1))
    step_table.add_column("Step", style="dim", width=4)
    step_table.add_column("Name", width=20)
    step_table.add_column("Status", width=8)
    step_table.add_column("Qual", justify="right", width=8)
    step_table.add_column("Elim", justify="right", width=8)

    # Get completed steps
    completed_steps = {r.step_num: r for r in state.step_results}

    for step_num in range(1, 7):
        name = STEP_NAMES[step_num]

        if step_num in completed_steps:
            result = completed_steps[step_num]
            status = "[green]Done[/green]"
            qual = f"{result.qualified:,}"
            elim = f"{result.eliminated:,}"
        elif step_num == state.current_step:
            status = "[yellow]> Run[/yellow]"
            qual = f"{state.qualified:,}"
            elim = f"{state.eliminated:,}"
        else:
            status = "[dim]...[/dim]"
            qual = "-"
            elim = "-"

        step_table.add_row(str(step_num), name, status, qual, elim)

    # Activity log
    activity_lines = list(state.activity_log)[-5:]
    if not activity_lines:
        activity_lines = ["[dim]Waiting for activity...[/dim]"]

    # Combine all sections using simple Text objects
    content = Group(
        header,
        Text(""),
        Text("\n".join(progress_lines)),
        Text(""),
        Text("Step Summary", style="bold"),
        step_table,
        Text(""),
        Text("Activity Log", style="bold"),
        Text("\n".join(activity_lines)),
    )

    return Panel(
        content,
        title="[bold blue]Pipeline Dashboard[/bold blue]",
        border_style="blue",
    )


def make_dashboard_callback(state: DashboardState, live: Live):
    """Create a callback function that updates the dashboard."""
    def callback(step_name: str, processed: int, total: int, qualified: int, eliminated: int = 0):
        state.step_name = step_name
        state.processed = processed
        state.total = total
        state.qualified = qualified
        state.eliminated = eliminated

        # Add to activity log periodically (every 10% or so)
        timestamp = datetime.now().strftime("%H:%M:%S")
        if total > 0:
            pct = (processed / total) * 100
            if processed == total:
                state.activity_log.append(f"[{timestamp}] ✓ {step_name} complete: {qualified:,} qualified")
            elif processed % max(1, total // 10) == 0:
                state.activity_log.append(f"[{timestamp}] Processing {processed:,}/{total:,} ({pct:.0f}%)...")

        live.update(render_dashboard(state))

    return callback


@click.group()
def cli():
    """Polymarket Profile Finder - Find and classify winning traders."""
    pass


@cli.command()
@click.option("--days", default=30, help="Number of days to analyze")
@click.option("--verbose", "-v", is_flag=True, help="Verbose output")
@click.option("--simple", is_flag=True, help="Use simple progress display instead of dashboard")
def full(days: int, verbose: bool, simple: bool):
    """Run full pipeline from scratch."""
    setup_logging()

    console.print(f"\n[bold blue]Starting full pipeline run for {days} days[/bold blue]\n")

    runner = PipelineRunner()

    if simple:
        # Simple progress display (original behavior)
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Running pipeline...", total=None)

            def callback(step_name, processed, total, qualified, eliminated=0):
                progress.update(task, completed=processed, total=total,
                              description=f"[{step_name}] {processed}/{total} ({qualified} qualified)")

            result = asyncio.run(runner.run_full(days=days, progress_callback=callback))
    else:
        # Enhanced dashboard display
        state = DashboardState()

        with Live(render_dashboard(state), console=console, refresh_per_second=4) as live:
            callback = make_dashboard_callback(state, live)

            def step_callback(step_num: int):
                """Called when a step completes."""
                state.complete_step()
                if step_num < 6:
                    state.reset_for_step(step_num + 1, STEP_NAMES[step_num + 1])
                live.update(render_dashboard(state))

            # Initialize for step 1
            state.reset_for_step(1, STEP_NAMES[1])
            live.update(render_dashboard(state))

            result = asyncio.run(runner.run_full(
                days=days,
                progress_callback=callback,
                step_callback=step_callback
            ))

    _print_results(result)


@cli.command()
@click.option("--days", default=1, help="Number of days to check for new addresses")
@click.option("--simple", is_flag=True, help="Use simple progress display instead of dashboard")
def incremental(days: int, simple: bool):
    """Run incremental update for new addresses."""
    setup_logging()

    console.print(f"\n[bold blue]Starting incremental update for {days} days[/bold blue]\n")

    runner = PipelineRunner()

    if simple:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Running incremental update...", total=None)

            def callback(step_name, processed, total, qualified, eliminated=0):
                progress.update(task, completed=processed, total=total,
                              description=f"[{step_name}] {processed}/{total} ({qualified} qualified)")

            result = asyncio.run(runner.run_incremental(days=days, progress_callback=callback))
    else:
        state = DashboardState()

        with Live(render_dashboard(state), console=console, refresh_per_second=4) as live:
            callback = make_dashboard_callback(state, live)

            def step_callback(step_num: int):
                state.complete_step()
                if step_num < 6:
                    state.reset_for_step(step_num + 1, STEP_NAMES[step_num + 1])
                live.update(render_dashboard(state))

            state.reset_for_step(1, STEP_NAMES[1])
            live.update(render_dashboard(state))

            result = asyncio.run(runner.run_incremental(
                days=days,
                progress_callback=callback,
                step_callback=step_callback
            ))

    console.print(f"\n[green]Incremental update complete![/green]")
    console.print(f"New addresses found: {result.get('new_addresses', 0)}")
    console.print(f"New qualified traders: {result.get('qualified', 0)}")


@cli.command()
@click.option("--step", type=int, required=True, help="Step to resume from (2-6)")
@click.option("--simple", is_flag=True, help="Use simple progress display instead of dashboard")
def resume(step: int, simple: bool):
    """Resume pipeline from a specific step."""
    if step < 2 or step > 6:
        console.print("[red]Step must be between 2 and 6[/red]")
        return

    setup_logging()

    console.print(f"\n[bold blue]Resuming pipeline from step {step}[/bold blue]\n")

    runner = PipelineRunner()

    if simple:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Resuming pipeline...", total=None)

            def callback(step_name, processed, total, qualified, eliminated=0):
                progress.update(task, completed=processed, total=total,
                              description=f"[{step_name}] {processed}/{total} ({qualified} qualified)")

            result = asyncio.run(runner.run_from_step(start_step=step, progress_callback=callback))
    else:
        state = DashboardState()

        # Mark earlier steps as completed (they were done previously)
        for i in range(1, step):
            state.step_results.append(StepResult(
                step_num=i,
                name=STEP_NAMES[i],
                status="done",
                qualified=0,  # Unknown from previous run
                eliminated=0,
            ))

        with Live(render_dashboard(state), console=console, refresh_per_second=4) as live:
            callback = make_dashboard_callback(state, live)

            def step_callback(step_num: int):
                state.complete_step()
                if step_num < 6:
                    state.reset_for_step(step_num + 1, STEP_NAMES[step_num + 1])
                live.update(render_dashboard(state))

            state.reset_for_step(step, STEP_NAMES[step])
            live.update(render_dashboard(state))

            result = asyncio.run(runner.run_from_step(
                start_step=step,
                progress_callback=callback,
                step_callback=step_callback
            ))

    console.print("\n[green]Pipeline resumed and completed![/green]")
    for key, value in result.items():
        console.print(f"{key}: {value}")


@cli.command()
def status():
    """Show current pipeline status."""
    runner = PipelineRunner()
    status = runner.get_pipeline_status()

    table = Table(title="Pipeline Status")
    table.add_column("Step", style="cyan")
    table.add_column("Traders", style="green")

    for step, count in status["traders_by_step"].items():
        table.add_row(f"Step {step}", str(count))

    console.print(table)

    if status["latest_run"]:
        console.print(f"\nLatest run: {status['latest_run']['status']}")
        if status["latest_run"].get("duration_seconds"):
            console.print(f"Duration: {status['latest_run']['duration_seconds']} seconds")


@cli.command()
@click.option("--profile", type=click.Choice(["copytrade", "bot", "insider", "all"]), default="all")
@click.option("--limit", default=20, help="Number of results to show")
def results(profile: str, limit: int):
    """Show classification results."""
    queries = TraderQueries()

    if profile == "copytrade" or profile == "all":
        traders = queries.get_top_copytrade_candidates(limit=limit)
        _print_trader_table("Copy Trade Candidates", traders, [
            ("Address", "address", lambda x: x[:10] + "..."),
            ("Win Rate", "win_rate_30d", lambda x: f"{x:.1f}%"),
            ("ROI", "roi_percent", lambda x: f"{x:.1f}%"),
            ("Portfolio", "portfolio_value", lambda x: f"${x:,.0f}"),
            ("Score", "copytrade_score", str),
        ])

    if profile == "bot" or profile == "all":
        traders = queries.get_likely_bots(limit=limit)
        _print_trader_table("Likely Bots", traders, [
            ("Address", "address", lambda x: x[:10] + "..."),
            ("Frequency", "trade_frequency", lambda x: f"{x:.1f}/day"),
            ("Night %", "night_trade_ratio", lambda x: f"{x:.1f}%"),
            ("Portfolio", "portfolio_value", lambda x: f"${x:,.0f}"),
            ("Score", "bot_score", str),
        ])

    if profile == "insider" or profile == "all":
        traders = queries.get_insider_suspects(limit=limit)
        _print_trader_table("Insider Suspects", traders, [
            ("Address", "address", lambda x: x[:10] + "..."),
            ("Max Position", "max_position_size", lambda x: f"${x:,.0f}"),
            ("Concentration", "position_concentration", lambda x: f"{x:.1f}%"),
            ("Age (days)", "account_age_days", str),
            ("Score", "insider_score", str),
        ])


@cli.command()
def stats():
    """Show overall statistics."""
    queries = TraderQueries()
    stats = queries.get_statistics()

    table = Table(title="Overall Statistics")
    table.add_column("Metric", style="cyan")
    table.add_column("Value", style="green")

    table.add_row("Total Traders", f"{stats['total_traders']:,}")
    table.add_row("Qualified Traders", f"{stats['qualified_traders']:,}")
    table.add_row("Copy Trade Candidates", f"{stats['copytrade_candidates']:,}")
    table.add_row("Likely Bots", f"{stats['likely_bots']:,}")
    table.add_row("Insider Suspects", f"{stats['insider_suspects']:,}")

    console.print(table)


@cli.command()
@click.argument("address")
def analyze(address: str):
    """Analyze a specific trader address."""
    from src.scoring.classifier import TraderClassifier
    from src.database.supabase import get_supabase_client

    db = get_supabase_client()
    trader = db.get_trader(address)

    if not trader:
        console.print(f"[red]Trader {address} not found in database[/red]")
        return

    classifier = TraderClassifier()
    analysis = classifier.get_detailed_analysis(trader)

    console.print(f"\n[bold]Trader Analysis: {address[:20]}...[/bold]\n")

    # Scores
    table = Table(title="Classification Scores")
    table.add_column("Profile", style="cyan")
    table.add_column("Score", style="green")
    table.add_column("Status")

    table.add_row(
        "Copy Trade",
        str(analysis["copytrade_score"]),
        "[green]Qualified[/green]" if analysis["copytrade_score"] >= 60 else "[red]Not Qualified[/red]"
    )
    table.add_row(
        "Bot",
        str(analysis["bot_score"]),
        "[yellow]Likely Bot[/yellow]" if analysis["bot_score"] >= 60 else "[green]Human[/green]"
    )
    table.add_row(
        "Insider",
        str(analysis["insider_score"]),
        "[red]Suspicious[/red]" if analysis["insider_score"] >= 60 else "[green]Normal[/green]"
    )

    console.print(table)

    console.print(f"\n[bold]Primary Classification:[/bold] {analysis['primary_classification']}")

    if analysis.get("insider_red_flags"):
        console.print("\n[bold red]Red Flags:[/bold red]")
        for flag in analysis["insider_red_flags"]:
            console.print(f"  - {flag}")


def _print_results(result: dict):
    """Print pipeline results."""
    console.print("\n[bold green]Pipeline Complete![/bold green]\n")

    table = Table(title="Pipeline Results")
    table.add_column("Step", style="cyan")
    table.add_column("Processed", style="white")
    table.add_column("Qualified", style="green")
    table.add_column("Eliminated", style="red")

    for step in ["step1", "step2", "step3", "step4", "step5", "step6"]:
        data = result.get(step, {})
        processed = data.get("total_found") or data.get("checked") or data.get("analyzed") or data.get("classified", 0)
        qualified = data.get("qualified") or data.get("analyzed") or data.get("classified", 0)
        eliminated = data.get("eliminated", 0)
        table.add_row(step.upper(), str(processed), str(qualified), str(eliminated))

    console.print(table)

    step6 = result.get("step6", {})
    console.print(f"\n[bold]Final Results:[/bold]")
    console.print(f"  Copy Trade Candidates: {step6.get('copytrade_candidates', 0)}")
    console.print(f"  Likely Bots: {step6.get('likely_bots', 0)}")
    console.print(f"  Insider Suspects: {step6.get('insider_suspects', 0)}")
    console.print(f"\nTotal duration: {result.get('duration_seconds', 0)} seconds")


def _print_trader_table(title: str, traders: list, columns: list):
    """Print a formatted trader table."""
    if not traders:
        console.print(f"\n[yellow]No {title.lower()} found[/yellow]")
        return

    table = Table(title=title)
    for col_name, _, _ in columns:
        table.add_column(col_name)

    for trader in traders:
        row = []
        for _, field, formatter in columns:
            value = trader.get(field, "N/A")
            if value is not None and value != "N/A":
                row.append(formatter(value))
            else:
                row.append("N/A")
        table.add_row(*row)

    console.print(table)


if __name__ == "__main__":
    cli()
