import asyncio

from src.automation.db import DatabaseConnection
from src.automation.deep_research_consumer import DeepResearchConsumer
from src.intelligence.dossier.state_extractor import StateExtractor


class StubDatabase(DatabaseConnection):
    def __init__(self):
        self.calls = []

    async def execute(self, query: str, *args):
        self.calls.append((query, args))
        return "UPDATE 1"


class FakeConn:
    def __init__(self):
        self.calls = []

    async def execute(self, query: str, *args):
        self.calls.append((query, args))
        return "OK"


def test_complete_research_item_no_longer_promotes_stub_startups():
    db = StubDatabase()

    asyncio.run(
        db.complete_research_item(
            item_id="123",
            research_output={"analysis": "done"},
            tokens_used=12,
            cost_usd=0.34,
        )
    )

    assert len(db.calls) == 1
    assert "UPDATE deep_research_queue" in db.calls[0][0]
    assert all("UPDATE startups" not in query for query, _ in db.calls)


def test_state_extractor_marks_startup_state_ready():
    conn = FakeConn()
    extractor = StateExtractor()

    asyncio.run(
        extractor.extract_snapshot(
            conn,
            startup_id="00000000-0000-0000-0000-000000000001",
            analysis_data={
                "funding_stage": "Seed",
                "vertical": "enterprise",
                "market_type": "vertical",
                "target_market": "b2b",
            },
            period="2026-03",
        )
    )

    assert len(conn.calls) == 2
    assert "INSERT INTO startup_state_snapshot" in conn.calls[0][0]
    assert "UPDATE startups" in conn.calls[1][0]
    assert "materialization_status = 'state_ready'" in conn.calls[1][0]


def test_deep_research_context_block_includes_existing_analysis_and_events():
    consumer = DeepResearchConsumer(db=object())

    analysis_block = consumer._build_existing_analysis_block(
        {
            "period": "2026-03",
            "materialization_status": "analysis_ready",
            "analysis_data": {
                "vertical": "enterprise",
                "build_patterns": [{"name": "agentic_workflows"}],
            },
        }
    )
    events_block = consumer._build_recent_events_block(
        {
            "recent_events": [
                {
                    "event_source": "news",
                    "event_type": "funding_news",
                    "event_title": "Raised Series A",
                    "event_date": "2026-03-15",
                }
            ]
        }
    )

    assert "materialization_status: analysis_ready" in analysis_block
    assert "build_patterns: agentic_workflows" in analysis_block
    assert "Raised Series A" in events_block
