"""External startup intelligence collection module.

This module collects intelligence from:
- Startup databases (Crunchbase, CB Insights, PitchBook, Tracxn, Dealroom)
- Big tech startup programs (Google, AWS, Microsoft, NVIDIA, Meta, Salesforce, Intel)
- Accelerators (YC, Techstars, 500 Global, Endeavor, Plug and Play, etc.)
- VC content resources (Sequoia, a16z, Greylock, First Round, etc.)

All data collection is time-bounded to a specific analysis period.
"""

from src.intelligence.aggregator import StartupIntelligenceAggregator
from src.intelligence.providers import (
    StartupProviderAggregator,
    CrunchbaseClient,
    CBInsightsClient,
    PitchBookClient,
    TracxnClient,
    DealroomClient,
)
from src.intelligence.tech_programs import TechProgramClient
from src.intelligence.accelerators import AcceleratorClient
from src.intelligence.vc_resources import VCResourceClient

__all__ = [
    "StartupIntelligenceAggregator",
    "StartupProviderAggregator",
    "CrunchbaseClient",
    "CBInsightsClient",
    "PitchBookClient",
    "TracxnClient",
    "DealroomClient",
    "TechProgramClient",
    "AcceleratorClient",
    "VCResourceClient",
]
