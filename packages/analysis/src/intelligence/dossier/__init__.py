"""Startup Intelligence Dossier System.

Structured state extraction, temporal diffing, and transition event emission
from startup analysis data. Zero LLM cost — pure extraction from existing
analysis_data JSONB.

Components:
    StateExtractor — Extract queryable state from analysis_data JSONB
    StateDiffer — Compare consecutive snapshots, generate history entries
    TransitionEmitter — Convert state diffs into startup_events for signal engine
"""

from src.intelligence.dossier.state_extractor import StateExtractor
from src.intelligence.dossier.state_differ import StateDiffer
from src.intelligence.dossier.transition_emitter import TransitionEmitter

__all__ = ["StateExtractor", "StateDiffer", "TransitionEmitter"]
