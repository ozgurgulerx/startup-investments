"""Optional adapter for agentic browser fallback on hard sites."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol

from src.data.models import StartupInput


@dataclass
class AgenticFallbackResult:
    invoked: bool
    reason: str
    recovered_fields: List[str] = field(default_factory=list)
    sources: List[Dict[str, Any]] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)


class AgenticFallbackAdapter(Protocol):
    async def recover(
        self,
        startup: StartupInput,
        *,
        missing_fields: List[str],
        reason: str,
    ) -> AgenticFallbackResult:
        ...


class NoOpAgenticFallbackAdapter:
    """Default adapter. Keeps the interface live while rollout stays disabled."""

    async def recover(
        self,
        startup: StartupInput,
        *,
        missing_fields: List[str],
        reason: str,
    ) -> AgenticFallbackResult:
        return AgenticFallbackResult(
            invoked=False,
            reason=f"agentic_fallback_disabled:{reason}",
            recovered_fields=[],
            sources=[],
            metadata={"startup_name": startup.name, "missing_fields": missing_fields},
        )


def build_agentic_fallback_adapter() -> AgenticFallbackAdapter:
    return NoOpAgenticFallbackAdapter()
