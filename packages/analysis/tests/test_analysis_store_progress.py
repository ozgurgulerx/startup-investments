import json

from src.data.models import StartupInput
from src.data.store import AnalysisStore


def test_reconcile_existing_base_analysis_skips_reprocessing(tmp_path):
    store = AnalysisStore(tmp_path / "analysis_store")
    startup = StartupInput(
        name="Acme AI",
        website="https://acme.ai",
        description="AI infrastructure",
    )

    base_file = store.base_dir / "acme-ai.json"
    base_file.write_text(
        json.dumps(
            {
                "company_name": "Acme AI",
                "input_hash": store._get_startup_hash(startup),
            }
        ),
        encoding="utf-8",
    )

    reconciled = store.reconcile_startups([startup])

    assert reconciled == 1
    assert store.get_stats()["total_startups"] == 1
    assert store.get_delta([startup]) == []


def test_reconcile_existing_base_analysis_without_saved_hash_reprocesses(tmp_path):
    store = AnalysisStore(tmp_path / "analysis_store")
    startup = StartupInput(
        name="Acme AI",
        website="https://acme.ai",
        description="AI infrastructure",
    )

    base_file = store.base_dir / "acme-ai.json"
    base_file.write_text(json.dumps({"company_name": "Acme AI"}), encoding="utf-8")

    store.reconcile_startups([startup])

    assert store.get_delta([startup]) == [startup]


def test_reconcile_existing_base_analysis_reprocesses_changed_startup(tmp_path):
    store = AnalysisStore(tmp_path / "analysis_store")
    old_startup = StartupInput(
        name="Acme AI",
        website="https://acme.ai",
        description="Old description",
    )
    new_startup = StartupInput(
        name="Acme AI",
        website="https://acme.ai",
        description="New description",
    )

    base_file = store.base_dir / "acme-ai.json"
    base_file.write_text(
        json.dumps(
            {
                "company_name": "Acme AI",
                "input_hash": store._get_startup_hash(old_startup),
            }
        ),
        encoding="utf-8",
    )

    store.reconcile_startups([new_startup])

    assert store.get_delta([new_startup]) == [new_startup]


def test_write_progress_checkpoint_persists_latest_snapshot(tmp_path):
    store = AnalysisStore(tmp_path / "analysis_store")

    store.write_progress_checkpoint(
        {
            "status": "running",
            "delta_total": 10,
            "completed": 3,
            "latest_startup": "Acme AI",
        }
    )

    payload = json.loads(store.progress_file.read_text(encoding="utf-8"))
    assert payload["status"] == "running"
    assert payload["delta_total"] == 10
    assert payload["completed"] == 3
    assert payload["latest_startup"] == "Acme AI"
    assert "updated_at" in payload
