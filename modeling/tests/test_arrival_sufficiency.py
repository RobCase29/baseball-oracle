from __future__ import annotations

import pandas as pd

import modeling.arrival_sufficiency as sufficiency
from modeling.arrival_sufficiency import audit_arrival_sufficiency


def _fixture() -> tuple[pd.DataFrame, pd.DataFrame, dict, dict, dict]:
    snapshots: list[dict] = []
    labels: list[dict] = []
    for season in (2018, 2019):
        for role in ("hitter", "pitcher"):
            for index in range(2):
                player_id = f"{season}-{role}-{index}"
                snapshot_id = f"snapshot-{player_id}"
                as_of = pd.Timestamp(f"{season}-12-31")
                event = index == 0
                snapshots.append(
                    {
                        "snapshot_id": snapshot_id,
                        "player_id": player_id,
                        "as_of": as_of,
                        "edition": season,
                        "role": role,
                        "age": 20 + index,
                        "prior_level": "AA",
                    }
                )
                label = {
                    "snapshot_id": snapshot_id,
                    "player_id": player_id,
                    "as_of": as_of,
                    "observed_60m": True,
                }
                for months in (12, 24, 36, 48, 60):
                    label[f"debut_within_{months}m"] = event
                labels.append(label)
    corpus = {"corpus_content_sha256": "a" * 64, "inputs": [{}]}
    metrics = {
        "inputs": {"corpus_content_sha256": "a" * 64},
        "model_configuration": {
            "selected_features": {
                "hitter": {
                    "numeric": ["age"],
                    "categorical": ["prior_level"],
                },
                "pitcher": {
                    "numeric": ["age"],
                    "categorical": ["prior_level"],
                },
            }
        },
        "validation": {
            "folds": [
                {
                    "horizons": {
                        "12": {"events": 2},
                        "60": {"events": 2},
                    }
                }
            ]
        },
        "producer": {"git": {"commit": "fixture", "dirty": False}},
    }
    thresholds = {
        "minimum_seasons": 2,
        "minimum_snapshots": 8,
        "minimum_players": 8,
        "minimum_mature_60m_rows": 8,
        "minimum_unique_60m_event_players": 4,
        "minimum_role_players": 4,
        "minimum_role_unique_60m_event_players": 2,
        "minimum_role_season_horizon_events": 1,
        "minimum_forward_folds": 1,
        "minimum_full_horizon_folds": 1,
        "minimum_scored_fold_horizon_events": 2,
        "minimum_identity_resolution_rate": 0.995,
        "maximum_selected_feature_missing_rate": 0.10,
    }
    return pd.DataFrame(snapshots), pd.DataFrame(labels), corpus, metrics, thresholds


def _lineage() -> dict:
    return {
        "seasons": [],
        "minimum_identity_resolution_rate": 1.0,
        "all_effective_time_safe": True,
        "all_knowledge_time_verified": False,
        "declared_team_pages": 4,
        "observed_team_pages": 4,
        "appearance_data_team_pages": 3,
        "declared_no_record_team_pages": 1,
        "failed_team_pages": 0,
    }


def test_research_sufficiency_is_distinct_from_publication(monkeypatch) -> None:
    snapshots, labels, corpus, metrics, thresholds = _fixture()
    monkeypatch.setattr(sufficiency, "_lineage_summary", lambda *_args, **_kwargs: _lineage())

    report = audit_arrival_sufficiency(
        snapshots,
        labels,
        corpus,
        metrics,
        thresholds=thresholds,
    )

    assert report["research_process_ready"] is True
    assert report["publication_ready"] is False
    assert report["status"] == "research_process_ready_not_publication_ready"
    assert all(gate["passed"] for gate in report["gates"])


def test_selected_feature_missingness_fails_research_gate(monkeypatch) -> None:
    snapshots, labels, corpus, metrics, thresholds = _fixture()
    snapshots.loc[snapshots["role"].eq("hitter"), "age"] = pd.NA
    monkeypatch.setattr(sufficiency, "_lineage_summary", lambda *_args, **_kwargs: _lineage())

    report = audit_arrival_sufficiency(
        snapshots,
        labels,
        corpus,
        metrics,
        thresholds=thresholds,
    )

    gate = next(
        item
        for item in report["gates"]
        if item["id"] == "maximum_selected_feature_missing_rate"
    )
    assert gate["passed"] is False
    assert report["research_process_ready"] is False


def test_misaligned_metric_and_corpus_addresses_are_rejected(monkeypatch) -> None:
    snapshots, labels, corpus, metrics, thresholds = _fixture()
    metrics["inputs"]["corpus_content_sha256"] = "b" * 64
    monkeypatch.setattr(sufficiency, "_lineage_summary", lambda *_args, **_kwargs: _lineage())

    try:
        audit_arrival_sufficiency(
            snapshots,
            labels,
            corpus,
            metrics,
            thresholds=thresholds,
        )
    except sufficiency.ArrivalSufficiencyError as error:
        assert "content addresses differ" in str(error)
    else:
        raise AssertionError("Expected a mismatched corpus address to fail")
