from src.runtime.job_state import RuntimeStateBackend, RuntimeStateStore


def test_runtime_state_store_round_trips_with_file_backend(tmp_path):
    store = RuntimeStateStore(
        backend=RuntimeStateBackend.FILE,
        fallback_dir=tmp_path,
        mirror_to_blob=False,
    )

    assert store.load("sync-data") is None

    backend = store.save(
        "sync-data",
        {"manifest_hash": "abc123", "last_db_sync_epoch": 42},
    )

    assert backend == RuntimeStateBackend.FILE
    assert store.load("sync-data") == {
        "manifest_hash": "abc123",
        "last_db_sync_epoch": 42,
    }


def test_runtime_state_store_deletes_file_backend_state(tmp_path):
    store = RuntimeStateStore(
        backend=RuntimeStateBackend.FILE,
        fallback_dir=tmp_path,
        mirror_to_blob=False,
    )

    store.save("product-canary", {"status": "warn"})
    assert store.load("product-canary") == {"status": "warn"}

    store.delete("product-canary")
    assert store.load("product-canary") is None
