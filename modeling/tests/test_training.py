import json

import pandas as pd

from modeling.contracts import CATEGORICAL_FEATURES, NUMERIC_FEATURES
from modeling.provenance import file_sha256, json_sha256
from modeling.train_arrival_baseline import build_person_period, load_dataset_manifest


def test_training_fold_cannot_see_future_debut() -> None:
    snapshot = {column: None for column in NUMERIC_FEATURES + CATEGORICAL_FEATURES}
    snapshot.update(
        {
            "snapshot_id": "snapshot-1",
            "player_id": "player-1",
            "edition": 2018,
            "as_of": pd.Timestamp("2018-12-31"),
        }
    )
    label = {
        "snapshot_id": "snapshot-1",
        "player_id": "player-1",
        "as_of": pd.Timestamp("2018-12-31"),
        "debut_date": pd.Timestamp("2021-01-01"),
        "data_cutoff": pd.Timestamp("2025-12-31"),
    }
    for months in (12, 24, 36, 48, 60):
        label[f"observed_{months}m"] = True
        label[f"debut_within_{months}m"] = months >= 36

    snapshots = pd.DataFrame([snapshot])
    labels = pd.DataFrame([label])
    early = build_person_period(snapshots, labels, pd.Timestamp("2020-12-31"))
    mature = build_person_period(snapshots, labels, pd.Timestamp("2022-12-31"))

    assert len(early) == 2
    assert early["event"].sum() == 0
    assert len(mature) == 3
    assert mature["event"].tolist() == [0, 0, 1]


def test_dataset_manifest_addresses_stable_content_and_exact_build(tmp_path) -> None:
    live_output = tmp_path / "prospect.parquet"
    pd.DataFrame([{"player_id": "player-1"}]).to_parquet(live_output, index=False)
    output_sha256 = file_sha256(live_output)
    dataset_content = {
        "schema_version": 1,
        "data_cutoff": "2025-12-31",
        "snapshot_policy": "test-policy",
        "source_lock_sha256": "b" * 64,
        "outputs": {"prospects": {"rows": 1, "sha256": output_sha256}},
    }
    dataset_address = json_sha256(dataset_content)
    archived_output = tmp_path / "datasets" / dataset_address / "prospects.parquet"
    archived_output.parent.mkdir(parents=True)
    archived_output.write_bytes(live_output.read_bytes())
    output = {
        "path": str(live_output),
        "content_addressed_path": str(archived_output),
        "rows": 1,
        "sha256": output_sha256,
    }
    manifest = {
        "schema_version": 1,
        "built_at": "2026-07-11T00:00:00-04:00",
        "data_cutoff": "2025-12-31",
        "snapshot_policy": "test-policy",
        "source_lock": {"sha256": "b" * 64},
        "outputs": {"prospects": output},
        "dataset_content_sha256": dataset_address,
    }
    manifest["manifest_sha256"] = json_sha256(manifest)
    body = json.dumps(manifest, indent=2) + "\n"
    path = tmp_path / "dataset_manifest.json"
    archive = tmp_path / "manifests" / f"{manifest['manifest_sha256']}.json"
    archive.parent.mkdir()
    path.write_text(body)
    archive.write_text(body)

    _, manifest_address, dataset_address = load_dataset_manifest(path)

    assert manifest_address == manifest["manifest_sha256"]
    assert dataset_address == manifest["dataset_content_sha256"]
