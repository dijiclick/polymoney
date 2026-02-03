"""
CSV writer for crypto tick data.

Writes to daily CSV files with NO header.
Format: bestBidUp,bestBidDown,bestAskUp,bestAskDown,timestamp_ms,marketPrice
"""

import asyncio
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class TickData:
    """Single tick data to write."""

    symbol: str  # BTC, ETH, etc.
    timeframe: str  # 15m, 1h, 4h, 1d
    best_bid_up: float
    best_bid_down: float
    best_ask_up: float
    best_ask_down: float
    timestamp_ms: int
    market_price: float


class CsvWriter:
    """
    Writes tick data to daily CSV files.

    Directory structure: {data_dir}/{SYMBOL}_{TIMEFRAME}/{YYYY-MM-DD}.csv
    Format: bestBidUp,bestBidDown,bestAskUp,bestAskDown,timestamp_ms,marketPrice
    No header.
    """

    def __init__(self, data_dir: str):
        self.data_dir = Path(data_dir)
        self._file_handles: dict[str, tuple] = {}  # key -> (file, current_date)
        self._lock = asyncio.Lock()
        self._write_count = 0

    async def initialize(self) -> None:
        """Initialize the writer."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"CSV writer initialized: {self.data_dir}")

    async def write_tick(self, tick: TickData) -> None:
        """Write a single tick to the appropriate CSV file."""
        async with self._lock:
            key = f"{tick.symbol}_{tick.timeframe}"
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

            # Get or create file handle
            file_handle = await self._get_file_handle(key, today)
            if file_handle is None:
                return

            # Write line: bestBidUp,bestBidDown,bestAskUp,bestAskDown,timestamp_ms,marketPrice
            line = f"{tick.best_bid_up},{tick.best_bid_down},{tick.best_ask_up},{tick.best_ask_down},{tick.timestamp_ms},{tick.market_price}\n"

            try:
                file_handle.write(line)
                file_handle.flush()
                self._write_count += 1
            except Exception as e:
                logger.error(f"Error writing tick: {e}")

    async def _get_file_handle(self, key: str, date: str):
        """Get file handle for the given key and date."""
        if key in self._file_handles:
            handle, handle_date = self._file_handles[key]
            if handle_date == date and not handle.closed:
                return handle
            # Date changed or file closed, close old handle
            try:
                handle.close()
            except Exception:
                pass

        # Create directory if needed
        dir_path = self.data_dir / key
        dir_path.mkdir(parents=True, exist_ok=True)

        # Open new file
        file_path = dir_path / f"{date}.csv"
        try:
            handle = open(file_path, "a", buffering=1)  # Line buffered
            self._file_handles[key] = (handle, date)
            logger.debug(f"Opened CSV file: {file_path}")
            return handle
        except Exception as e:
            logger.error(f"Error opening CSV file {file_path}: {e}")
            return None

    async def flush_all(self) -> None:
        """Flush all open file handles."""
        async with self._lock:
            for key, (handle, _) in self._file_handles.items():
                try:
                    if not handle.closed:
                        handle.flush()
                except Exception as e:
                    logger.debug(f"Error flushing {key}: {e}")

    async def close(self) -> None:
        """Close all file handles."""
        async with self._lock:
            for key, (handle, _) in list(self._file_handles.items()):
                try:
                    if not handle.closed:
                        handle.flush()
                        handle.close()
                except Exception as e:
                    logger.debug(f"Error closing {key}: {e}")
            self._file_handles.clear()
            logger.info(f"CSV writer closed. Total writes: {self._write_count}")

    @property
    def stats(self) -> dict:
        """Get writer statistics."""
        return {
            "write_count": self._write_count,
            "open_files": len(self._file_handles),
            "data_dir": str(self.data_dir),
        }
