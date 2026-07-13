"""Reproduce the offline prospect-score challenger and censoring audit."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from modeling.milb_impact_tournament import (
    CATEGORICAL_FEATURES,
    NUMERIC_FEATURES,
    PRIMARY_TARGET_COLUMN,
    RANDOM_SEED,
    _weighted_binary_metrics,
    make_expanding_origin_folds,
    player_equal_weights,
    prepare_labeled_panel,
)


ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP_REPETITIONS = 500
BOOTSTRAP_SEED = RANDOM_SEED
FULL_MODEL_COLUMN = "probability__regularized_logistic"
NO_AGE_MODEL_COLUMN = "no_age_full_performance"
AGE_BAND_LABELS = (
    "19_or_younger",
    "20_21",
    "22_23",
    "24_25",
    "26_or_older",
)


def model(numeric: list[str], categorical: list[str]) -> Pipeline:
    transformers = []
    if numeric:
        transformers.append(
            (
                "numeric",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="median", add_indicator=True)),
                        ("scale", StandardScaler()),
                    ]
                ),
                numeric,
            )
        )
    if categorical:
        transformers.append(
            (
                "categorical",
                Pipeline(
                    [
                        ("impute", SimpleImputer(strategy="constant", fill_value="missing")),
                        ("one_hot", OneHotEncoder(handle_unknown="ignore", min_frequency=20)),
                    ]
                ),
                categorical,
            )
        )
    return Pipeline(
        [
            ("features", ColumnTransformer(transformers)),
            (
                "classifier",
                LogisticRegression(
                    C=0.25,
                    max_iter=2_000,
                    solver="lbfgs",
                    random_state=RANDOM_SEED,
                ),
            ),
        ]
    )


def get_data() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    snapshots = pd.read_parquet(ROOT / "data/processed/arrival-population-v1/snapshots.parquet")
    targets = pd.read_parquet(ROOT / "artifacts/milb-impact-v1/targets.parquet")
    panel, _ = prepare_labeled_panel(snapshots, targets)
    p5 = pd.read_parquet(ROOT / "artifacts/milb-impact-v1/oof_predictions.parquet")
    p10 = pd.read_parquet(ROOT / "artifacts/milb-impact-v1/exploratory_10war_oof_predictions.parquet")
    return snapshots, targets, panel, p5.merge(
        p10[["snapshot_id", "probability__regularized_logistic"]].rename(
            columns={"probability__regularized_logistic": "p10"}
        ),
        on="snapshot_id",
        validate="one_to_one",
    )


def run_ablations(panel: pd.DataFrame, existing: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    variants = {
        "age_role_level": (["age"], ["role", "last_observed_level"]),
        "no_age_full_performance": (
            [c for c in NUMERIC_FEATURES if c != "age"],
            list(CATEGORICAL_FEATURES),
        ),
    }
    folds = make_expanding_origin_folds(panel)
    rows = []
    for fold in folds:
        train = panel.loc[list(fold.train_index)].copy()
        valid = panel.loc[list(fold.validation_index)].copy()
        weights = player_equal_weights(train)
        output = valid[["snapshot_id", "player_id", "edition", PRIMARY_TARGET_COLUMN]].copy()
        for name, (numeric, categorical) in variants.items():
            features = numeric + categorical
            estimator = model(numeric, categorical)
            estimator.fit(
                train[features],
                train[PRIMARY_TARGET_COLUMN].astype(int),
                classifier__sample_weight=weights,
            )
            output[name] = estimator.predict_proba(valid[features])[:, 1]
        rows.append(output)
    predictions = pd.concat(rows, ignore_index=True)
    predictions = predictions.merge(
        existing[
            [
                "snapshot_id",
                "mlb_war_next_5_seasons",
                "probability__age_level_role_performance_prior",
                "probability__regularized_logistic",
                "p10",
                "age",
                "role",
                "last_observed_level",
            ]
        ],
        on="snapshot_id",
        validate="one_to_one",
    )
    weight = player_equal_weights(predictions)
    truth = predictions[PRIMARY_TARGET_COLUMN].astype(int).to_numpy()
    players = predictions["player_id"].astype(str).to_numpy()
    probability_columns = {
        "age_role_level": "age_role_level",
        "age_level_role_performance_prior": "probability__age_level_role_performance_prior",
        "no_age_full_performance": "no_age_full_performance",
        "full_regularized_logistic": "probability__regularized_logistic",
    }
    metrics = {}
    for name, column in probability_columns.items():
        metrics[name] = _weighted_binary_metrics(
            truth,
            predictions[column].to_numpy(float),
            weight,
            players,
        )
        metrics[name] = {
            key: metrics[name][key]
            for key in (
                "rocAuc",
                "averagePrecision",
                "brier",
                "logLoss",
                "calibrationInTheLarge",
                "calibrationSlope",
                "topOnePercent",
                "topFivePercent",
                "topDecile",
            )
        }
    return predictions, metrics


def bootstrap_age_contribution(
    predictions: pd.DataFrame,
    *,
    repetitions: int = BOOTSTRAP_REPETITIONS,
    seed: int = BOOTSTRAP_SEED,
) -> dict:
    """Compare full and no-age AP with paired player-cluster resampling."""
    if repetitions <= 0:
        raise ValueError("Bootstrap repetitions must be positive")

    required = {
        "player_id",
        PRIMARY_TARGET_COLUMN,
        FULL_MODEL_COLUMN,
        NO_AGE_MODEL_COLUMN,
    }
    missing = sorted(required.difference(predictions.columns))
    if missing:
        raise ValueError(f"Bootstrap predictions are missing columns: {missing}")

    players = predictions["player_id"].astype(str).to_numpy()
    unique_players, player_codes = np.unique(players, return_inverse=True)
    truth = predictions[PRIMARY_TARGET_COLUMN].astype(int).to_numpy()
    full_score = predictions[FULL_MODEL_COLUMN].to_numpy(float)
    no_age_score = predictions[NO_AGE_MODEL_COLUMN].to_numpy(float)
    base_weights = player_equal_weights(predictions)
    full_sample_ap = float(average_precision_score(truth, full_score, sample_weight=base_weights))
    no_age_sample_ap = float(average_precision_score(truth, no_age_score, sample_weight=base_weights))

    full_distribution: list[float] = []
    no_age_distribution: list[float] = []
    delta_distribution: list[float] = []
    rng = np.random.default_rng(seed)
    for _ in range(repetitions):
        sampled_codes = rng.integers(0, len(unique_players), size=len(unique_players))
        cluster_multiplicity = np.bincount(sampled_codes, minlength=len(unique_players))
        sampled_weights = base_weights * cluster_multiplicity[player_codes]
        included = sampled_weights > 0
        full_ap = float(average_precision_score(
            truth[included],
            full_score[included],
            sample_weight=sampled_weights[included],
        ))
        no_age_ap = float(average_precision_score(
            truth[included],
            no_age_score[included],
            sample_weight=sampled_weights[included],
        ))
        full_distribution.append(full_ap)
        no_age_distribution.append(no_age_ap)
        delta_distribution.append(full_ap - no_age_ap)

    deltas = np.asarray(delta_distribution, dtype=float)
    full_wins = int((deltas > 0).sum())
    no_age_wins = int((deltas < 0).sum())
    ties = repetitions - full_wins - no_age_wins
    return {
        "method": "paired player-cluster bootstrap with global player-equal OOF weights",
        "metric": "average_precision",
        "comparison": "full_regularized_logistic minus no_age_full_performance",
        "repetitions": int(repetitions),
        "seed": int(seed),
        "playerClusters": int(len(unique_players)),
        "fullSample": {
            "fullRegularizedLogistic": full_sample_ap,
            "noAgeFullPerformance": no_age_sample_ap,
            "delta": full_sample_ap - no_age_sample_ap,
        },
        "wins": {
            "fullRegularizedLogistic": full_wins,
            "noAgeFullPerformance": no_age_wins,
            "ties": ties,
            "fullModelWinRate": full_wins / repetitions,
        },
        "pairedDelta": {
            "mean": float(deltas.mean()),
            "median": float(np.median(deltas)),
            "interval95": [float(value) for value in np.quantile(deltas, [0.025, 0.975])],
            "minimum": float(deltas.min()),
            "maximum": float(deltas.max()),
        },
        "modelIntervals95": {
            "fullRegularizedLogistic": [
                float(value) for value in np.quantile(full_distribution, [0.025, 0.975])
            ],
            "noAgeFullPerformance": [
                float(value) for value in np.quantile(no_age_distribution, [0.025, 0.975])
            ],
        },
    }


def calibration_group(
    frame: pd.DataFrame,
    *,
    label: str,
) -> dict:
    weights = frame["_audit_weight"].to_numpy(float)
    truth = frame[PRIMARY_TARGET_COLUMN].astype(int).to_numpy()
    prediction = frame[FULL_MODEL_COLUMN].to_numpy(float)
    observed = float(np.average(truth, weights=weights))
    predicted = float(np.average(prediction, weights=weights))
    return {
        "cohort": label,
        "rows": int(len(frame)),
        "players": int(frame["player_id"].nunique()),
        "eventRows": int(truth.sum()),
        "eventPlayers": int(frame.loc[frame[PRIMARY_TARGET_COLUMN].eq(1), "player_id"].nunique()),
        "weight": float(weights.sum()),
        "meanPrediction": predicted,
        "weightedEventRate": observed,
        "calibrationGap": predicted - observed,
    }


def age_level_calibration(predictions: pd.DataFrame) -> dict:
    """Report full-model calibration by age and by level for the youngest band."""
    required = {
        "player_id",
        "age",
        "last_observed_level",
        PRIMARY_TARGET_COLUMN,
        FULL_MODEL_COLUMN,
    }
    missing = sorted(required.difference(predictions.columns))
    if missing:
        raise ValueError(f"Calibration predictions are missing columns: {missing}")

    audited = predictions.copy()
    audited["_audit_weight"] = player_equal_weights(audited)
    audited["_age_band"] = pd.cut(
        pd.to_numeric(audited["age"], errors="coerce"),
        bins=[-np.inf, 19, 21, 23, 25, np.inf],
        labels=AGE_BAND_LABELS,
    ).astype("string").fillna("missing")
    audited["_level"] = (
        audited["last_observed_level"].astype("string").fillna("missing")
    )

    age_groups = []
    for label in (*AGE_BAND_LABELS, "missing"):
        group = audited.loc[audited["_age_band"].eq(label)]
        if not group.empty:
            age_groups.append(calibration_group(group, label=label))

    youngest = audited.loc[audited["_age_band"].eq(AGE_BAND_LABELS[0])]
    youngest_by_level = [
        calibration_group(group, label=str(level))
        for level, group in youngest.groupby("_level", sort=True, observed=True)
    ]
    return {
        "model": "full_regularized_logistic",
        "weighting": "global player-equal OOF weights retained within each cohort",
        "gapDefinition": "meanPrediction minus weightedEventRate; positive is overprediction",
        "overall": calibration_group(audited, label="all_ages"),
        "ageBands": age_groups,
        "age19OrYoungerByLevel": youngest_by_level,
    }


def rank_metrics(frame: pd.DataFrame) -> dict:
    latest = frame.sort_values(["edition", "snapshot_id"]).drop_duplicates("player_id", keep="last")
    war = np.clip(latest["mlb_war_next_5_seasons"].to_numpy(float), 0, None)
    event = latest[PRIMARY_TARGET_COLUMN].astype(int).to_numpy()
    scores = {
        "age_only_younger_is_better": -latest["age"].to_numpy(float),
        "p5": latest["probability__regularized_logistic"].to_numpy(float),
        "p10": latest["p10"].to_numpy(float),
        "ordinal_p5_plus_p10": (
            latest["probability__regularized_logistic"].to_numpy(float)
            + latest["p10"].to_numpy(float)
        ),
    }
    result = {"players": int(len(latest)), "positiveWar": float(war.sum()), "events": int(event.sum())}
    for name, score in scores.items():
        order = np.argsort(-score, kind="mergesort")
        model_result = {"spearmanWar": float(spearmanr(score, war).statistic)}
        for frac in (0.01, 0.05, 0.10):
            n = max(1, int(np.ceil(len(order) * frac)))
            selected = order[:n]
            model_result[f"top{int(frac*100)}pctWarShare"] = float(war[selected].sum() / war.sum())
            model_result[f"top{int(frac*100)}pctEventRecall"] = float(event[selected].sum() / event.sum())
        result[name] = model_result
    return result


def terminal_audit(existing: pd.DataFrame, targets: pd.DataFrame, snapshots: pd.DataFrame) -> dict:
    career = pd.read_parquet(ROOT / "data/processed/model-v1/career_outcomes.parquet")
    war = pd.read_csv(ROOT / "data/processed/baseball-reference-mlb-war/player_seasons.csv", low_memory=False)
    war = war.loc[pd.to_numeric(war["season"], errors="coerce").le(2025)].copy()
    war["total_war"] = pd.to_numeric(war["total_war"], errors="coerce").fillna(0.0)
    career_war = war.groupby("bbref_id", as_index=False).agg(
        career_war=("total_war", "sum"), last_war_season=("season", "max")
    )
    base = existing.merge(
        targets[["snapshot_id", "resolved_bbref_id", "identity_resolution"]],
        on="snapshot_id",
        validate="one_to_one",
    ).merge(
        snapshots[["snapshot_id", "player_name"]],
        on="snapshot_id",
        validate="one_to_one",
    )
    career_status = career.loc[career["bbref_id"].notna(), [
        "bbref_id", "career_resolution", "last_observed_season", "final_game"
    ]].drop_duplicates("bbref_id")
    base = base.merge(
        career_status,
        left_on="resolved_bbref_id",
        right_on="bbref_id",
        how="left",
        validate="many_to_one",
    ).merge(
        career_war,
        left_on="resolved_bbref_id",
        right_on="bbref_id",
        how="left",
        validate="many_to_one",
        suffixes=("", "_war"),
    )
    base["career_war"] = base["career_war"].fillna(0.0)
    base["no_mlb"] = base["resolved_bbref_id"].isna()
    base["resolved_mlb"] = (
        base["resolved_bbref_id"].notna()
        & base["career_resolution"].eq("three_year_inactivity_proxy")
        & pd.to_numeric(base["last_observed_season"], errors="coerce").le(2022)
    )
    base["unresolved_mlb"] = base["resolved_bbref_id"].notna() & ~base["resolved_mlb"]
    base["conservative_zero"] = base["no_mlb"] & base["edition"].le(2017)
    strict = base.loc[base["resolved_mlb"] | base["conservative_zero"]].copy()
    player_strict = strict.sort_values("edition").drop_duplicates("player_id", keep="last")
    mlb = base.loc[base["resolved_bbref_id"].notna()].copy()
    censoring = {}
    for quantile in (0.5, 0.8, 0.9, 0.95, 0.99):
        threshold = mlb["probability__regularized_logistic"].quantile(quantile)
        tail = mlb.loc[mlb["probability__regularized_logistic"].ge(threshold)]
        censoring[str(quantile)] = {
            "rows": int(len(tail)),
            "unresolvedShare": float(tail["unresolved_mlb"].mean()),
            "meanLowerBoundWar": float(tail["career_war"].mean()),
        }
    return {
        "rows": int(len(base)),
        "players": int(base["player_id"].nunique()),
        "noMlbRows": int(base["no_mlb"].sum()),
        "resolvedMlbRows": int(base["resolved_mlb"].sum()),
        "unresolvedMlbRows": int(base["unresolved_mlb"].sum()),
        "strictTerminalRows": int(len(strict)),
        "strictTerminalPlayers": int(player_strict["player_id"].nunique()),
        "strictResolvedMlbPlayers": int(player_strict["resolved_mlb"].sum()),
        "strictEventsGe1War": int(player_strict["career_war"].ge(1).sum()),
        "strictEventsGe5War": int(player_strict["career_war"].ge(5).sum()),
        "strictEventsGe10War": int(player_strict["career_war"].ge(10).sum()),
        "strictEventsGe20War": int(player_strict["career_war"].ge(20).sum()),
        "maxStrictResolvedCareerWar": float(player_strict["career_war"].max()),
        "unresolvedMlbPlayers": int(
            base.loc[base["unresolved_mlb"], "player_id"].nunique()
        ),
        "unresolvedGe5WarPlayers": int(
            base.loc[base["unresolved_mlb"] & base["career_war"].ge(5), "player_id"].nunique()
        ),
        "unresolvedGe20WarPlayers": int(
            base.loc[base["unresolved_mlb"] & base["career_war"].ge(20), "player_id"].nunique()
        ),
        "censoringByP5Tail": censoring,
        "topUnresolved": base.loc[base["unresolved_mlb"]]
        .sort_values("career_war", ascending=False)
        .drop_duplicates("player_id")[[
            "player_name", "edition", "career_war", "probability__regularized_logistic", "p10"
        ]]
        .head(15)
        .to_dict("records"),
    }


def main() -> None:
    snapshots, targets, panel, existing = get_data()
    predictions, ablations = run_ablations(panel, existing)
    report = {
        "ageAblations": ablations,
        "ageContributionBootstrap": bootstrap_age_contribution(predictions),
        "ageLevelCalibration": age_level_calibration(predictions),
        "rankMagnitude": rank_metrics(predictions),
        "terminalAudit": terminal_audit(existing, targets, snapshots),
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
