from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PROTOCOL_PATH = ROOT / "modeling/config/s-tier-tournament-v1.json"


def load_protocol() -> dict[str, object]:
    return json.loads(PROTOCOL_PATH.read_text(encoding="utf-8"))


def test_protocol_cannot_be_mistaken_for_a_completed_or_released_model() -> None:
    protocol = load_protocol()
    boundary = protocol["claimBoundary"]

    assert protocol["schemaVersion"] == "oracle-registered-tournament/v1"
    assert protocol["status"] == "registered_not_executed"
    assert boundary["ultimateModelClaimAllowed"] is False
    assert boundary["releaseEligibleAtRegistration"] is False
    assert boundary["marketReturnIsSeparate"] is True
    assert boundary["rankIsNotProbability"] is True


def test_protocol_registers_point_in_time_ablation_and_shadow_holdout() -> None:
    protocol = load_protocol()
    feature_ids = {group["id"] for group in protocol["featureGroups"]}
    evaluation = protocol["evaluation"]
    shadow = protocol["shadowHoldout"]

    assert {
        "context_normalized_performance",
        "development_trajectory",
        "availability_and_durability",
        "point_in_time_scouting",
        "milb_tracking",
        "mlb_statcast",
    } <= feature_ids
    assert evaluation["randomRowSplitsAllowed"] is False
    assert evaluation["playerClustered"] is True
    assert evaluation["predictionOriginChronological"] is True
    assert evaluation["transformationsFitWithinFold"] is True
    assert evaluation["calibrationFitWithinFold"] is True
    assert shadow["status"] == "planned_not_frozen"
    assert shadow["labelAccess"] == "sealed_until_each_predeclared_horizon_matures"
    assert shadow["tuningAfterFreezeAllowed"] is False
    assert shadow["predictionRevisionsAllowed"] is False


def test_protocol_keeps_vendor_composites_and_market_outcomes_out_of_talent_model() -> None:
    protocol = load_protocol()
    prohibited = set(protocol["prohibitedFeatures"])
    gates = protocol["promotionGates"]

    assert "prospect_savant_composite_score" in prohibited
    assert "provider_composite_used_as_oracle_target" in prohibited
    assert "market_price_or_card_return_in_baseball_talent_model" in prohibited
    assert gates["lineage"]["pointInTimeFeatureFraction"] == 1.0
    assert gates["tail"]["p95AndP99EvaluationRequired"] is True
    assert gates["operations"]["currentUniverseScoreCoverageMinimum"] >= 0.995
