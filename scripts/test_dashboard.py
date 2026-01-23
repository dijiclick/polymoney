#!/usr/bin/env python3
"""Test script to demonstrate the dashboard with mock data."""

import sys
import time
import random
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from rich.console import Console, Group
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

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
    status: str
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
        self.current_step = step_num
        self.step_name = step_name
        self.processed = 0
        self.total = 0
        self.qualified = 0
        self.eliminated = 0
        self.step_start_time = time.time()

    def complete_step(self):
        self.step_results.append(StepResult(
            step_num=self.current_step,
            name=self.step_name,
            status="done",
            qualified=self.qualified,
            eliminated=self.eliminated,
        ))

    def get_rate(self) -> float:
        elapsed = time.time() - self.step_start_time
        if elapsed > 0 and self.processed > 0:
            return self.processed / elapsed
        return 0.0

    def get_eta(self) -> Optional[int]:
        rate = self.get_rate()
        if rate > 0 and self.total > self.processed:
            return int((self.total - self.processed) / rate)
        return None

    def get_elapsed(self) -> int:
        return int(time.time() - self.step_start_time)


def render_dashboard(state: DashboardState) -> Panel:
    """Render the full dashboard panel."""
    header = Text()
    header.append("POLYMARKET PIPELINE\n", style="bold blue")
    header.append(f"Step {state.current_step}/6: {state.step_name}", style="cyan")

    progress_lines = []

    if state.total > 0:
        pct = (state.processed / state.total) * 100
        filled = int(pct / 5)
        bar = "#" * filled + "-" * (20 - filled)
        progress_lines.append(f"[{bar}]  {pct:5.1f}%  ({state.processed:,} / {state.total:,})")
    else:
        progress_lines.append("[" + "-" * 20 + "]  Initializing...")

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

    progress_lines.append(f"+ Qualified: {state.qualified:,}   - Eliminated: {state.eliminated:,}")

    step_table = Table(show_header=True, header_style="bold", box=None, padding=(0, 1))
    step_table.add_column("Step", style="dim", width=4)
    step_table.add_column("Name", width=20)
    step_table.add_column("Status", width=8)
    step_table.add_column("Qual", justify="right", width=8)
    step_table.add_column("Elim", justify="right", width=8)

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

    activity_lines = list(state.activity_log)[-5:]
    if not activity_lines:
        activity_lines = ["[dim]Waiting for activity...[/dim]"]

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


def simulate_step(state: DashboardState, live: Live, step_num: int, total: int, qual_rate: float = 0.5):
    """Simulate processing a step."""
    state.reset_for_step(step_num, STEP_NAMES[step_num])
    state.total = total
    live.update(render_dashboard(state))

    batch_size = max(1, total // 20)  # Process in ~20 batches

    for i in range(0, total, batch_size):
        processed = min(i + batch_size, total)
        new_qual = int((processed - state.processed) * qual_rate)
        new_elim = (processed - state.processed) - new_qual

        state.processed = processed
        state.qualified += new_qual
        state.eliminated += new_elim

        timestamp = datetime.now().strftime("%H:%M:%S")
        pct = (processed / total) * 100

        if processed == total:
            state.activity_log.append(f"[{timestamp}] Step {step_num} complete: {state.qualified:,} qualified")
        else:
            state.activity_log.append(f"[{timestamp}] Processing {processed:,}/{total:,} ({pct:.0f}%)...")

        live.update(render_dashboard(state))
        time.sleep(0.15)  # Simulate work

    state.complete_step()
    live.update(render_dashboard(state))
    time.sleep(0.3)


def main():
    console.print("\n[bold blue]Starting Dashboard Demo with Mock Data[/bold blue]\n")

    state = DashboardState()

    # Simulated data for each step
    step_data = [
        (1, 5000, 0.4),   # Step 1: 5000 addresses, 40% qualify
        (2, 2000, 0.6),   # Step 2: 2000 traders, 60% qualify
        (3, 1200, 0.75),  # Step 3: 1200 traders, 75% qualify
        (4, 900, 0.7),    # Step 4: 900 traders, 70% qualify
        (5, 630, 1.0),    # Step 5: 630 traders, all pass (analysis only)
        (6, 630, 1.0),    # Step 6: 630 traders, all classified
    ]

    with Live(render_dashboard(state), console=console, refresh_per_second=10) as live:
        for step_num, total, qual_rate in step_data:
            simulate_step(state, live, step_num, total, qual_rate)

    console.print("\n[bold green]Demo Complete![/bold green]")
    console.print(f"Total steps: 6")
    console.print(f"Final qualified traders: {state.step_results[-1].qualified}")


if __name__ == "__main__":
    main()
