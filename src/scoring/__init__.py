"""Scoring algorithms for trader classification."""

from .copytrade import CopytradeScorer
from .bot import BotScorer
from .insider import InsiderScorer
from .classifier import TraderClassifier

__all__ = ["CopytradeScorer", "BotScorer", "InsiderScorer", "TraderClassifier"]
