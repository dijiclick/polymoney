"""Bot detection metrics."""

import statistics
from datetime import datetime
from typing import Optional


class BotDetector:
    """Detect bot-like trading patterns."""

    @staticmethod
    def calculate_indicators(activity: list[dict]) -> dict:
        """
        Calculate metrics that indicate automated trading.

        Returns dict with:
        - trade_time_variance_hours: std dev of trade times (low = bot)
        - night_trade_ratio: % of trades 00:00-06:00 UTC (high = bot)
        - position_size_variance: coefficient of variation of sizes (low = bot)
        - trade_frequency: trades per day
        """
        if not activity:
            return {}

        trades = [a for a in activity if a.get("type") in ["TRADE", "BUY", "SELL"]]

        if len(trades) < 10:
            return {}

        # 1. Trade Time Variance (bots trade at regular intervals)
        timestamps = [t.get("timestamp", 0) for t in trades if t.get("timestamp")]
        if len(timestamps) < 2:
            time_variance = float("inf")
        else:
            timestamps.sort()
            intervals = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]
            time_variance = statistics.stdev(intervals) / 3600 if len(intervals) > 1 else float("inf")

        # 2. Night Trading Ratio (bots trade 24/7)
        night_trades = 0
        for t in trades:
            ts = t.get("timestamp", 0)
            if ts:
                hour = datetime.fromtimestamp(ts).hour
                if 0 <= hour < 6:
                    night_trades += 1
        night_ratio = (night_trades / len(trades)) * 100 if trades else 0

        # 3. Position Size Variance (bots use consistent sizing)
        sizes = []
        for t in trades:
            size = t.get("usdcSize") or t.get("size") or t.get("amount")
            if size:
                try:
                    sizes.append(float(size))
                except (ValueError, TypeError):
                    pass

        if sizes and len(sizes) > 1:
            mean_size = statistics.mean(sizes)
            if mean_size > 0:
                size_variance = (statistics.stdev(sizes) / mean_size) * 100
            else:
                size_variance = 100
        else:
            size_variance = 100

        # 4. Trade Frequency
        if len(timestamps) >= 2:
            days_active = (max(timestamps) - min(timestamps)) / 86400
            trade_frequency = len(trades) / days_active if days_active > 0 else 0
        else:
            trade_frequency = len(trades)

        return {
            "trade_time_variance_hours": time_variance,
            "night_trade_ratio": night_ratio,
            "position_size_variance": size_variance,
            "trade_frequency": trade_frequency
        }

    @staticmethod
    def detect_regular_intervals(activity: list[dict], tolerance_percent: float = 20) -> bool:
        """
        Detect if trades occur at regular intervals.

        Returns True if trading pattern shows regular timing (bot-like).
        """
        trades = [a for a in activity if a.get("type") in ["TRADE", "BUY", "SELL"]]

        if len(trades) < 20:
            return False

        timestamps = sorted([t.get("timestamp", 0) for t in trades if t.get("timestamp")])
        if len(timestamps) < 20:
            return False

        intervals = [timestamps[i+1] - timestamps[i] for i in range(len(timestamps)-1)]

        if not intervals:
            return False

        median_interval = statistics.median(intervals)
        if median_interval <= 0:
            return False

        # Check how many intervals are within tolerance of median
        tolerance = median_interval * (tolerance_percent / 100)
        regular_count = sum(
            1 for i in intervals
            if abs(i - median_interval) <= tolerance
        )

        # If more than 60% are regular, likely a bot
        return (regular_count / len(intervals)) > 0.6

    @staticmethod
    def detect_rapid_trading(activity: list[dict], threshold_seconds: int = 60) -> int:
        """
        Count trades that occur within threshold_seconds of each other.

        High count indicates automated trading.
        """
        trades = [a for a in activity if a.get("type") in ["TRADE", "BUY", "SELL"]]
        timestamps = sorted([t.get("timestamp", 0) for t in trades if t.get("timestamp")])

        if len(timestamps) < 2:
            return 0

        rapid_count = 0
        for i in range(len(timestamps) - 1):
            if timestamps[i+1] - timestamps[i] <= threshold_seconds:
                rapid_count += 1

        return rapid_count

    @staticmethod
    def calculate_timing_score(activity: list[dict]) -> float:
        """
        Calculate a score based on trading timing patterns.

        Higher score = more likely to be a bot.
        """
        indicators = BotDetector.calculate_indicators(activity)

        if not indicators:
            return 0

        score = 0

        # Low time variance = regular intervals = bot
        variance = indicators.get("trade_time_variance_hours", float("inf"))
        if variance <= 0.5:
            score += 30
        elif variance <= 1:
            score += 20
        elif variance <= 2:
            score += 10

        # High night trading = 24/7 operation = bot
        night = indicators.get("night_trade_ratio", 0)
        if night >= 30:
            score += 25
        elif night >= 20:
            score += 15
        elif night >= 10:
            score += 5

        # Low size variance = consistent sizing = bot
        size_var = indicators.get("position_size_variance", 100)
        if size_var <= 10:
            score += 25
        elif size_var <= 20:
            score += 15
        elif size_var <= 30:
            score += 5

        # High frequency
        freq = indicators.get("trade_frequency", 0)
        if freq >= 50:
            score += 20
        elif freq >= 20:
            score += 10
        elif freq >= 10:
            score += 5

        return min(100, score)
