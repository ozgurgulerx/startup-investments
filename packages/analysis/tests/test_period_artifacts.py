from src.storage.period_artifacts import PeriodArtifactStore


def test_period_artifact_prefixes_are_region_aware():
    store = PeriodArtifactStore(client=None)

    assert store.period_prefix("2026-02", "global") == "2026-02"
    assert store.period_prefix("2026-02", "turkey") == "tr/2026-02"
    assert store.period_prefix("2026-02", "tr") == "tr/2026-02"


def test_relative_blob_path_matches_period_tree_layout():
    store = PeriodArtifactStore(client=None)

    assert (
        store.relative_blob_path("2026-02", "output/analysis_store/index.json", region="global")
        == "2026-02/output/analysis_store/index.json"
    )
    assert (
        store.relative_blob_path("2026-02", "input/startups.csv", region="turkey")
        == "tr/2026-02/input/startups.csv"
    )
