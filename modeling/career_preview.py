from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Mapping, Sequence

import numpy as np
import pandas as pd

try:
    from modeling.alpha_signal import (
        HistoricalHallBaseline,
        build_alpha_signal,
        rank_alpha_signals,
    )
    from modeling.career_data import (
        build_career_landmarks,
        build_prospect_bridge,
        latest_landmarks,
        normalize_jaws_standards,
        normalize_player_seasons,
        peak_seven,
        standard_lookup,
    )
    from modeling.career_tournament import (
        MODEL_VERSION,
        QUANTILE_LEVELS,
        TARGET_VERSION,
        CareerScoringBundle,
        CareerTournament,
        quantile_dict,
    )
    from modeling.career_chapters import (
        CareerChapterModel,
        withheld_career_chapter,
    )
    from modeling.relative_standing import HistoricalPaceReference
except ModuleNotFoundError:
    from alpha_signal import (
        HistoricalHallBaseline,
        build_alpha_signal,
        rank_alpha_signals,
    )
    from career_data import (
        build_career_landmarks,
        build_prospect_bridge,
        latest_landmarks,
        normalize_jaws_standards,
        normalize_player_seasons,
        peak_seven,
        standard_lookup,
    )
    from career_tournament import (
        MODEL_VERSION,
        QUANTILE_LEVELS,
        TARGET_VERSION,
        CareerScoringBundle,
        CareerTournament,
        quantile_dict,
    )
    from career_chapters import CareerChapterModel, withheld_career_chapter
    from relative_standing import HistoricalPaceReference


PREVIEW_SCHEMA_VERSION = "career-oracle-preview/v1"
PROSPECT_BRIDGE_TARGET_VERSION = "mlb-debut-age-mixed-final-standard-bridge-v1"
SELECTIVE_TARGET_DOMAIN_DISCLOSURE = (
    "Tournament metrics are conditional on careers that remain in the supported "
    "single-role, exact-standard target domain; future two-way, cross-role, and "
    "unsupported-standard transition risk is not modeled."
)


def _age_value(value: object) -> float | None:
    numeric = pd.to_numeric(pd.Series([value]), errors="coerce").iloc[0]
    return None if pd.isna(numeric) else round(float(numeric), 2)


def _actual_value_column(role: str) -> str:
    if role == "hitter":
        return "b_war"
    if role == "pitcher":
        return "p_war"
    return "total_war"


def _current_scoring_rows(
    panel: pd.DataFrame,
    normalized_seasons: pd.DataFrame,
    standards: pd.DataFrame,
    roster: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, dict[str, dict[str, Any]], int]:
    in_season = normalized_seasons.loc[normalized_seasons["season_state"].eq("in_season")]
    if not in_season.empty:
        current_season = int(in_season["season"].max())
    else:
        current_season = int(normalized_seasons["season"].max())
    roster_by_id: dict[str, dict[str, Any]] = {}
    if roster is not None:
        accepted = roster.loc[roster["bbref_id"].notna()].copy()
        accepted["bbref_id"] = accepted["bbref_id"].astype(str).str.strip()
        accepted = accepted.loc[accepted["bbref_id"].ne("")]
        if accepted["bbref_id"].duplicated().any():
            raise ValueError("Roster contains duplicate canonical Baseball-Reference IDs")
        roster_by_id = {
            str(row["bbref_id"]): dict(row) for row in accepted.to_dict("records")
        }
        current_ids = tuple(sorted(roster_by_id))
    else:
        census = (
            in_season.loc[in_season["season"].eq(current_season)]
            if not in_season.empty
            else normalized_seasons.loc[normalized_seasons["season"].eq(current_season)]
        )
        current_ids = tuple(sorted(census["bbref_id"].unique()))
    completed = latest_landmarks(panel.loc[panel["bbref_id"].isin(current_ids)])
    feature_rows = {str(row["bbref_id"]): dict(row) for row in completed.to_dict("records")}
    context: dict[str, dict[str, Any]] = {}

    for player_id in current_ids:
        player_history = normalized_seasons.loc[
            normalized_seasons["bbref_id"].eq(player_id)
        ].sort_values("season", kind="mergesort")
        current_rows = player_history.loc[player_history["season"].eq(current_season)]
        current = current_rows.iloc[-1] if not current_rows.empty else player_history.iloc[-1]
        feature_partial = player_id not in feature_rows
        if feature_partial:
            pseudo = player_history.copy()
            pseudo.loc[pseudo["season_state"].eq("in_season"), "season_state"] = "complete"
            pseudo_panel = build_career_landmarks(
                pseudo,
                standards,
                as_of_year=current_season,
            )
            feature_rows[player_id] = dict(pseudo_panel.iloc[-1])
        feature = feature_rows[player_id]
        context[player_id] = {
            "history": player_history,
            "current": dict(current),
            "featurePartial": feature_partial,
            "featureSeason": int(feature["season"]),
            "partialSeason": bool(
                player_history.loc[player_history["season"].eq(current_season), "season_state"]
                .eq("in_season")
                .any()
            ),
            "roster": roster_by_id.get(player_id),
            "noCurrentSeasonAppearance": current_rows.empty,
        }
    scoring = pd.DataFrame([feature_rows[player_id] for player_id in current_ids])
    return scoring.reset_index(drop=True), context, current_season


def _career_arc(
    history: pd.DataFrame,
    role: str,
    final_quantiles: Sequence[float] | None,
    current_age: float | None,
) -> list[dict[str, Any]]:
    column = _actual_value_column(role)
    values = history[column].fillna(0.0).to_numpy(dtype=float)
    cumulative = np.cumsum(values)
    ages = history["age"].to_numpy(dtype=float)
    if current_age is not None:
        missing = ~np.isfinite(ages)
        ages[missing] = current_age - (int(history["season"].max()) - history.loc[missing, "season"])
    points: list[dict[str, Any]] = []
    for index, row in enumerate(history.to_dict("records")):
        if not math.isfinite(float(ages[index])):
            continue
        actual = round(float(cumulative[index]), 3)
        points.append(
            {
                "age": round(float(ages[index]), 2),
                "season": int(row["season"]),
                "p10": actual,
                "p25": actual,
                "p50": actual,
                "p75": actual,
                "p90": actual,
                "actual": actual,
                "seasonState": str(row["season_state"]),
            }
        )
    if current_age is not None and final_quantiles is not None:
        terminal_age = min(
            current_age + 10.0,
            max(current_age + 2.0, 39.0 if role == "pitcher" else 37.0),
        )
        projected = quantile_dict(final_quantiles)
        points.append({"age": round(terminal_age, 2), **projected, "projection": "terminal_only"})
    return points


def _confidence(
    season_number: int,
    interval_width: float,
    *,
    partial_feature: bool,
    standard_fallback: bool,
    era_gap_years: int,
) -> dict[str, Any]:
    score = 0.35 + min(max(season_number, 0), 8) * 0.055
    score -= min(max(interval_width - 25.0, 0.0) / 200.0, 0.18)
    if partial_feature:
        score -= 0.18
    if standard_fallback:
        score -= 0.12
    if era_gap_years > 10:
        score -= 0.15
    elif era_gap_years > 5:
        score -= 0.08
    score = float(np.clip(score, 0.15, 0.85))
    state = "high" if score >= 0.72 else "moderate" if score >= 0.48 else "low"
    return {
        "score": round(score, 3),
        "state": state,
        "rankIndependent": True,
        "intervalWidth": round(float(interval_width), 3),
        "method": "heuristic_evidence_state_not_calibrated_confidence_probability",
    }


def build_mlb_preview_players(
    panel: pd.DataFrame,
    player_seasons: pd.DataFrame,
    standards: pd.DataFrame,
    scoring_bundle: CareerScoringBundle,
    roster: pd.DataFrame | None = None,
    external_ids: Mapping[str, int] | None = None,
    chapter_model: CareerChapterModel | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    seasons = normalize_player_seasons(player_seasons)
    scoring, contexts, current_season = _current_scoring_rows(
        panel, seasons, standards, roster
    )
    forecast_peak_floors: list[float] = []
    for row in scoring.to_dict("records"):
        history = contexts[str(row["bbref_id"])]["history"]
        feature_history = history.loc[history["season"].le(int(row["season"]))]
        values = feature_history[_actual_value_column(str(row["role"]))]
        forecast_peak_floors.append(
            peak_seven(values.fillna(0.0).to_numpy(dtype=float))
        )
    (
        probabilities,
        final_quantiles,
        peak_quantiles,
        jaws_quantiles,
        jaws_margin_quantiles,
        scenario_support_shifts,
    ) = scoring_bundle.predict_distribution(
        scoring, peak_floor=np.asarray(forecast_peak_floors, dtype=float)
    )
    standards_by_key = standard_lookup(standards)
    pace_reference = HistoricalPaceReference(panel)
    alpha_reference = HistoricalHallBaseline(panel)
    players: list[dict[str, Any]] = []
    for index, feature in scoring.reset_index(drop=True).iterrows():
        player_id = str(feature["bbref_id"])
        context = contexts[player_id]
        history = context["history"]
        current = context["current"]
        roster_row = context.get("roster") or {}
        role = str(feature["role"])
        withheld_two_way = role == "two_way"
        withheld_role_switch = bool(feature["broad_role_switch"])
        withheld_standard_fallback = bool(feature["standard_fallback"])
        season_number = int(feature["season_number"])
        stage_key = (
            "first"
            if season_number == 1
            else "seasons_2_3"
            if season_number <= 3
            else "seasons_4_6"
            if season_number <= 6
            else "seasons_7_10"
            if season_number <= 10
            else "season_11_plus"
        )
        performance_edges = scoring_bundle.lineage.get(
            "performanceBankCareerWarEdges", {}
        ).get(
            f"{role}:{stage_key}"
        )
        withheld_young_elite = bool(
            f"{role}:{stage_key}"
            in set(scoring_bundle.lineage.get("withheldHighPerformanceStages", []))
            and performance_edges is not None
            and float(feature["career_war_to_date"]) >= performance_edges[1]
        )
        withheld_early_mlb = bool(
            scoring_bundle.lineage.get("withholdEarlyMlbRanking")
            and season_number <= 3
        )
        withheld_partial_only = bool(context["featurePartial"])
        withheld_stale_feature = int(feature["season"]) < 2025
        withheld_no_current_appearance = bool(context["noCurrentSeasonAppearance"])
        withheld_forecast = (
            withheld_two_way
            or withheld_role_switch
            or withheld_standard_fallback
            or withheld_young_elite
            or withheld_early_mlb
            or withheld_partial_only
            or withheld_stale_feature
            or withheld_no_current_appearance
        )
        value_column = _actual_value_column(role)
        actual_values = history[value_column].fillna(0.0).to_numpy(dtype=float)
        cumulative_actual = float(actual_values.sum())
        current_peak = peak_seven(actual_values)
        forecast_peak = float(forecast_peak_floors[index])
        peak_values = np.maximum(peak_quantiles[index], forecast_peak)
        final_values = np.maximum.accumulate(final_quantiles[index])
        peak_values = np.maximum.accumulate(peak_values)
        warnings = ["research_only", "retrospective_validation_only"]
        warnings.append("final_scoring_refit_uses_frozen_held_out_calibration")
        warnings.append("current_scoring_refit_not_cross_fitted_or_evaluated")
        if not (withheld_two_way or withheld_role_switch or withheld_standard_fallback):
            warnings.append("hof_target_rebaselines_if_career_to_date_standard_changes")
        warnings.append("confidence_is_heuristic_not_coverage_probability")
        if context["partialSeason"]:
            warnings.append("partial_season_input")
            if context["featurePartial"]:
                warnings.append("partial_season_feature_fallback")
            else:
                warnings.append("forecast_features_exclude_current_partial_season")
        if context["noCurrentSeasonAppearance"]:
            warnings.append("rostered_without_2026_mlb_appearance")
        if roster_row:
            if bool(roster_row.get("is_dl")):
                warnings.append("roster_status_injured_list")
            elif not bool(roster_row.get("is_active")):
                warnings.append("roster_status_other_40_man")
        if bool(feature["standard_fallback"]):
            warnings.append(str(feature["standard_warning"] or "standard_fallback"))
        if withheld_two_way:
            warnings.append("two_way_target_not_preregistered_forecast_withheld")
        if withheld_role_switch:
            warnings.append("broad_role_switch_target_not_supported_forecast_withheld")
        if withheld_standard_fallback:
            warnings.append("synthetic_hall_standard_forecast_withheld")
        if withheld_young_elite:
            warnings.append("young_elite_distribution_gate_failed_forecast_withheld")
        if withheld_early_mlb:
            warnings.append("rookie_ranking_gate_failed_forecast_withheld")
        if season_number <= 3:
            warnings.append("early_hall_tail_not_learned_research_only")
        if withheld_partial_only:
            warnings.append("partial_only_unvalidated_forecast_withheld")
        if withheld_stale_feature:
            warnings.append("stale_return_feature_state_forecast_withheld")
        if withheld_no_current_appearance:
            warnings.append("current_opportunity_unobserved_forecast_withheld")
        if (
            not (withheld_two_way or withheld_role_switch or withheld_standard_fallback)
            and abs(float(scenario_support_shifts[index])) > 1e-12
        ):
            warnings.append("single_scenario_jaws_tail_support_extension")
        warnings.append("career_arc_terminal_timing_baseline")
        age = (
            _age_value(roster_row.get("age"))
            or _age_value(current.get("age"))
            or _age_value(feature["age"])
        )
        position = str(feature["position"])
        probability = (
            None
            if withheld_forecast
            else float(np.clip(probabilities[index], 0.0, 1.0))
        )
        final_distribution = None if withheld_forecast else quantile_dict(final_values)
        peak_distribution = None if withheld_forecast else quantile_dict(peak_values)
        jaws_distribution = (
            None if withheld_forecast else quantile_dict(jaws_quantiles[index])
        )
        jaws_margin_distribution = (
            None if withheld_forecast else quantile_dict(jaws_margin_quantiles[index])
        )
        training_end_year = int(scoring_bundle.lineage["trainingCareerEndYear"])
        era_gap_years = int(feature["season"]) - training_end_year
        if era_gap_years > 5:
            warnings.append(f"scoring_era_extrapolation_from_{training_end_year}")
        confidence = (
            {"score": None, "state": "withheld", "rankIndependent": True}
            if withheld_forecast
            else _confidence(
                int(feature["season_number"]),
                final_distribution["p90"] - final_distribution["p10"],
                partial_feature=bool(context["featurePartial"]),
                standard_fallback=bool(feature["standard_fallback"]),
                era_gap_years=era_gap_years,
            )
        )
        standard = standards_by_key[str(feature["standard_key"])]
        historical_signal = pace_reference.relative_signal(
            feature,
            partial_feature=bool(context["featurePartial"]),
        )
        historical_pace = historical_signal.get("historicalPace")
        historical_percentile = (
            float(historical_pace["percentile"])
            if isinstance(historical_pace, Mapping)
            and historical_pace.get("percentile") is not None
            else None
        )
        completed_feature_history = history.loc[
            history["season"].le(int(feature["season"]))
        ]
        completed_war = completed_feature_history[_actual_value_column(role)].fillna(0.0)
        prior_war_per_season = (
            float(completed_war.iloc[:-1].tail(3).mean())
            if len(completed_war) > 1
            else None
        )
        career_chapter = (
            chapter_model.forecast(
                feature,
                historical_pace_percentile=historical_percentile,
                prior_war_per_season=prior_war_per_season,
                partial_feature=bool(context["featurePartial"]),
            )
            if chapter_model is not None
            else withheld_career_chapter(
                feature,
                historical_pace_percentile=historical_percentile,
                prior_war_per_season=prior_war_per_season,
            )
        )
        chapter_track = career_chapter.get("roleTrack")
        prime_start_age = (
            chapter_model.boundaries.get(str(chapter_track), {}).get("primeStartAge")
            if chapter_model is not None
            else None
        )
        alpha_signal = build_alpha_signal(
            feature,
            modeled_probability=probability,
            jaws_margin=jaws_margin_distribution,
            career_chapter=career_chapter,
            historical_signal=historical_signal,
            baseline_reference=alpha_reference,
            prime_start_age=prime_start_age,
            partial_feature=bool(context["featurePartial"]),
        )
        forecast_as_of = (
            str(current.get("known_at") or roster_row.get("known_at"))
            if context["featurePartial"]
            else f"{int(feature['season'])}-12-31T00:00:00.000Z"
        )
        actual_as_of = str(
            roster_row.get("known_at")
            or current.get("known_at")
            or forecast_as_of
        )
        roster_status = (
            "injured_list"
            if bool(roster_row.get("is_dl"))
            else "active"
            if bool(roster_row.get("is_active"))
            else "other_40_man"
            if roster_row
            else "season_participant"
        )
        standard_reference = None if withheld_two_way else {
            "key": str(feature["standard_key"]),
            "label": str(standard["label"]),
            "roleOrPosition": str(feature["standard_key"]),
            "jaws": round(float(standard["jaws_standard"]), 3),
            "careerWar": round(float(standard["career_war_standard"]), 3),
            "peakSevenWar": round(float(standard["peak_seven_war_standard"]), 3),
            "fallbackUsed": bool(standard.get("derived_fallback", False)),
            "derivedFallback": bool(standard.get("derived_fallback", False)),
            "scope": "career_to_date_primary_target_rebaselines_with_role_or_position",
        }
        players.append(
            {
                "canonicalId": f"bbref:{player_id}",
                "canonicalPlayerId": f"bbref:{player_id}",
                "externalIds": {
                    "bbref": player_id,
                    "mlbam": (external_ids or {}).get(player_id),
                },
                "bbrefId": player_id,
                "name": str(
                    roster_row.get("player_name")
                    or current.get("player_name")
                    or feature["player_name"]
                ),
                "stage": "early_mlb" if int(feature["season_number"]) <= 3 else "established_mlb",
                "playerType": role,
                "age": age,
                "organization": str(
                    roster_row.get("team_name")
                    or current.get("team")
                    or feature["team"]
                ),
                "organizationCode": str(
                    roster_row.get("team_id") or current.get("team") or feature["team"]
                ),
                "position": position,
                "level": "MLB",
                "asOf": forecast_as_of,
                "forecastAsOf": forecast_as_of,
                "featureAsOf": forecast_as_of,
                "actualAsOf": actual_as_of,
                "publicationState": "withheld" if withheld_forecast else "research",
                "rank": None if withheld_forecast else 0,
                "rankScope": "mlb_active_census",
                "hofCaliberProbability": (
                    None if probability is None else round(probability, 8)
                ),
                "finalCareerWar": final_distribution,
                "peakSevenWar": peak_distribution,
                "finalJaws": jaws_distribution,
                "jawsMargin": jaws_margin_distribution,
                "scenarioSupportExtensionJaws": (
                    None
                    if withheld_forecast
                    else round(float(scenario_support_shifts[index]), 3)
                ),
                "cumulativeWar": round(cumulative_actual, 3),
                "currentPeakSevenWar": round(current_peak, 3),
                "arrivalProbability36": None,
                "standardKey": str(feature["standard_key"]),
                "standardFallback": bool(feature["standard_fallback"]),
                "standardReference": standard_reference,
                "hofStandard": standard_reference,
                "rosterStatus": roster_status,
                "careerArc": _career_arc(
                    history, role, None if withheld_forecast else final_values, age
                ),
                "confidence": confidence,
                "intervalWidth": (
                    None
                    if final_distribution is None
                    else round(
                        final_distribution["p90"] - final_distribution["p10"], 3
                    )
                ),
                "warnings": sorted(set(warnings)),
                "relativeSignal": historical_signal,
                "careerChapter": career_chapter,
                "alphaSignal": alpha_signal,
                "decomposition": {
                    "arrivalProbability": 1.0,
                    "conditionalHofCaliberProbability": (
                        None if probability is None else round(probability, 8)
                    ),
                    "hofCaliberGivenMlbProbability": (
                        None if probability is None else round(probability, 8)
                    ),
                    "unconditionalHofCaliberProbability": (
                        None if probability is None else round(probability, 8)
                    ),
                    "noMlbProbability": 0.0,
                    "observedCumulativeWar": round(cumulative_actual, 3),
                },
                "lineage": {
                    "modelVersion": MODEL_VERSION,
                    "targetVersion": TARGET_VERSION,
                    "forecastFeatureSeason": int(feature["season"]),
                    "forecastFeatureAsOf": forecast_as_of,
                    "actualEvidenceAsOf": actual_as_of,
                    "actualThroughSeason": int(history["season"].max()),
                    "selectedEntrant": scoring_bundle.selected_entrant,
                    "pointModelTrainingCareerEndYear": scoring_bundle.lineage.get(
                        "pointModelTrainingCareerEndYear"
                    ),
                    "fullPlayerCrossFit": bool(
                        scoring_bundle.lineage.get("fullPlayerCrossFit", False)
                    ),
                    "inheritsTournamentMetrics": False,
                },
            }
        )
    rank_alpha_signals(players)
    players.sort(
        key=lambda player: (
            player["hofCaliberProbability"] is None,
            -float(player["hofCaliberProbability"] or 0.0),
            -float((player["finalCareerWar"] or {}).get("p50", 0.0)),
            str(player["bbrefId"]),
        )
    )
    rank = 0
    for player in players:
        if player["hofCaliberProbability"] is not None:
            rank += 1
            player["rank"] = rank
    return players, {
        "season": current_season,
        "players": len(players),
        "censusSource": "40_man_roster" if roster is not None else "season_participants",
        "partialSeason": bool(
            seasons.loc[seasons["season"].eq(current_season), "season_state"]
            .eq("in_season")
            .any()
        ),
    }


def _weighted_mixture_quantiles(
    conditional: Mapping[str, float], arrival_probability: float
) -> dict[str, float]:
    probability = float(np.clip(arrival_probability, 0.0, 1.0))
    values = np.asarray([conditional[name] for name in ("p10", "p25", "p50", "p75", "p90")])
    grid = (np.arange(1000, dtype=float) + 0.5) / 1000.0
    conditional_samples = np.interp(grid, QUANTILE_LEVELS, values, left=values[0], right=values[-1])
    samples = np.concatenate([conditional_samples, np.asarray([0.0])])
    weights = np.concatenate(
        [np.full(len(conditional_samples), probability / len(conditional_samples)), [1.0 - probability]]
    )
    order = np.argsort(samples, kind="stable")
    sorted_values = samples[order]
    sorted_weights = weights[order]
    cumulative = np.cumsum(sorted_weights) - 0.5 * sorted_weights
    cumulative /= sorted_weights.sum()
    quantiles = np.interp(QUANTILE_LEVELS, cumulative, sorted_values)
    return quantile_dict(quantiles)


def _expected_debut_age(age: float, probabilities: Sequence[float]) -> int:
    if not math.isfinite(age):
        raise ValueError("Prospect age must be finite")
    cumulative = np.maximum.accumulate(np.asarray(probabilities, dtype=float))
    masses = np.diff(np.concatenate([[0.0], cumulative]))
    if cumulative[-1] <= 1e-9:
        expected_months = 60.0
    else:
        expected_months = float(np.dot(masses, [6, 18, 30, 42, 54]) / cumulative[-1])
    projected_age = int(round(age + expected_months / 12.0))
    return max(int(math.ceil(age)), projected_age)


def build_prospect_forecasts(
    arrival_preview: Mapping[str, Any] | None,
    bridge: Sequence[Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    if not arrival_preview:
        return {}
    horizons = [int(value) for value in arrival_preview.get("horizons", [])]
    if 36 not in horizons or 60 not in horizons:
        raise ValueError("Arrival preview must provide 36- and 60-month probabilities")
    index36 = horizons.index(36)
    index60 = horizons.index(60)
    bridge_index = {
        (str(row["role"]), int(row["estimatedDebutAge"])): row for row in bridge
    }
    bridge_ages_by_role: dict[str, list[int]] = {}
    for role, debut_age in bridge_index:
        bridge_ages_by_role.setdefault(role, []).append(debut_age)
    forecasts: dict[str, dict[str, Any]] = {}
    for key, estimate in sorted(dict(arrival_preview.get("estimates", {})).items()):
        try:
            _, role = key.rsplit(":", 1)
            age = float(estimate["age"])
            probabilities = [float(value) for value in estimate["probabilities"]]
        except (KeyError, TypeError, ValueError) as error:
            raise ValueError(f"Malformed arrival estimate: {key}") from error
        debut_age = _expected_debut_age(age, probabilities)
        arrival36 = float(np.clip(probabilities[index36], 0.0, 1.0))
        arrival60 = float(np.clip(probabilities[index60], 0.0, 1.0))
        bridge_row = bridge_index.get((role, debut_age))
        if bridge_row is None:
            supported_ages = sorted(bridge_ages_by_role.get(role, []))
            support_min = supported_ages[0] if supported_ages else None
            support_max = supported_ages[-1] if supported_ages else None
            outside_support = bool(
                support_min is not None
                and support_max is not None
                and (debut_age < support_min or debut_age > support_max)
            )
            warning = (
                "bridge_debut_age_outside_supported_range_forecast_withheld"
                if outside_support
                else "bridge_debut_age_cell_missing_forecast_withheld"
            )
            forecasts[key] = {
                "canonicalPlayerId": f"mlbam:{key}",
                "asOf": arrival_preview.get("asOf"),
                "modelVersion": "arrival-post-pandemic-v1-amendment-001+mlb-debut-age-bridge-v1",
                "targetVersion": PROSPECT_BRIDGE_TARGET_VERSION,
                "stage": "pre_debut",
                "playerType": role,
                "publicationState": "withheld",
                "rank": None,
                "rankScope": "prospect_arrival_bridge",
                "hofCaliberProbability": None,
                "arrivalProbability36": round(arrival36, 8),
                "arrivalProbability60": round(arrival60, 8),
                "finalCareerWar": None,
                "peakSevenWar": None,
                "finalCareerWarConditionalOnArrival": None,
                "peakSevenWarConditionalOnArrival": None,
                "standardReference": None,
                "hofStandard": None,
                "probabilityScope": "arrival_only_bridge_forecast_withheld",
                "confidence": {
                    "score": None,
                    "state": "withheld",
                    "rankIndependent": True,
                },
                "warnings": sorted(
                    [
                        "research_only",
                        "arrival_external_validation_failed",
                        "arrival_age_projection_not_clipped_to_bridge_support",
                        warning,
                    ]
                ),
                "milbAlphaSignal": estimate.get("milbAlphaSignal"),
                "decomposition": {
                    "arrivalHorizonMonths": 60,
                    "arrivalProbability": round(arrival60, 8),
                    "conditionalHofCaliberProbability": None,
                    "hofCaliberGivenMlbProbability": None,
                    "unconditionalHofCaliberProbability": None,
                    "noMlbProbability": round(1.0 - arrival60, 8),
                    "estimatedDebutAge": debut_age,
                },
                "lineage": {
                    "arrivalSnapshotId": estimate.get("snapshotId"),
                    "arrivalAsOf": arrival_preview.get("asOf"),
                    "arrivalStatus": arrival_preview.get("status"),
                    "bridgeVersion": "mlb-debut-age-bridge-v1",
                    "targetVersion": PROSPECT_BRIDGE_TARGET_VERSION,
                    "bridgeSupportedAgeMinimum": support_min,
                    "bridgeSupportedAgeMaximum": support_max,
                },
            }
            continue
        conditional_hof = float(bridge_row["conditionalHofCaliberProbability"])
        unconditional_hof = arrival60 * conditional_hof
        conditional_war = dict(bridge_row["finalCareerWar"])
        conditional_peak = dict(bridge_row["peakSevenWar"])
        warnings = [
            "research_only",
            "arrival_external_validation_failed",
            "bridge_baseline_not_direct_milb_to_hof_training",
            "mixed_position_target_bridge_no_single_standard",
            "unconditional_probability_uses_60_month_arrival_horizon",
            "not_eventual_arrival_probability_lower_bound_proxy",
        ]
        if bool(estimate.get("coldStart")):
            warnings.append("arrival_cold_start")
        forecasts[key] = {
            "canonicalPlayerId": f"mlbam:{key}",
            "asOf": arrival_preview.get("asOf"),
            "modelVersion": "arrival-post-pandemic-v1-amendment-001+mlb-debut-age-bridge-v1",
            "targetVersion": PROSPECT_BRIDGE_TARGET_VERSION,
            "stage": "pre_debut",
            "playerType": role,
            "publicationState": "research",
            "rank": 0,
            "rankScope": "prospect_arrival_bridge",
            "hofCaliberProbability": round(unconditional_hof, 8),
            "arrivalProbability36": round(arrival36, 8),
            "arrivalProbability60": round(arrival60, 8),
            "finalCareerWar": _weighted_mixture_quantiles(conditional_war, arrival60),
            "peakSevenWar": {
                name: max(0.0, value)
                for name, value in _weighted_mixture_quantiles(conditional_peak, arrival60).items()
            },
            "finalCareerWarConditionalOnArrival": conditional_war,
            "peakSevenWarConditionalOnArrival": conditional_peak,
            "standardReference": None,
            "hofStandard": None,
            "probabilityScope": "arrival_within_60_months_lower_bound_proxy",
            "confidence": {
                "score": 0.25 if bool(estimate.get("coldStart")) else 0.35,
                "state": "low",
                "rankIndependent": True,
            },
            "warnings": sorted(warnings),
            "milbAlphaSignal": estimate.get("milbAlphaSignal"),
            "decomposition": {
                "arrivalHorizonMonths": 60,
                "arrivalProbability": round(arrival60, 8),
                "conditionalHofCaliberProbability": round(conditional_hof, 8),
                "hofCaliberGivenMlbProbability": round(conditional_hof, 8),
                "unconditionalHofCaliberProbability": round(unconditional_hof, 8),
                "noMlbProbability": round(1.0 - arrival60, 8),
                "estimatedDebutAge": debut_age,
            },
            "lineage": {
                "arrivalSnapshotId": estimate.get("snapshotId"),
                "arrivalAsOf": arrival_preview.get("asOf"),
                "arrivalStatus": arrival_preview.get("status"),
                "bridgeVersion": "mlb-debut-age-bridge-v1",
                "targetVersion": PROSPECT_BRIDGE_TARGET_VERSION,
            },
        }
    ranked = sorted(
        (
            forecast
            for forecast in forecasts.values()
            if forecast["publicationState"] != "withheld"
        ),
        key=lambda forecast: (
            -float(forecast["hofCaliberProbability"]),
            -float(forecast["finalCareerWar"]["p50"]),
            str(forecast["canonicalPlayerId"]),
        ),
    )
    for rank, forecast in enumerate(ranked, start=1):
        forecast["rank"] = rank
    return forecasts


def build_preview_payload(
    *,
    as_of: str,
    panel: pd.DataFrame,
    player_seasons: pd.DataFrame,
    standards: pd.DataFrame,
    tournament: CareerTournament,
    scoring_bundle: CareerScoringBundle,
    arrival_preview: Mapping[str, Any] | None = None,
    roster: pd.DataFrame | None = None,
    external_ids: Mapping[str, int] | None = None,
    chapter_model: CareerChapterModel | None = None,
    lineage: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    players, census = build_mlb_preview_players(
        panel,
        player_seasons,
        standards,
        scoring_bundle,
        roster,
        external_ids,
        chapter_model,
    )
    bridge = build_prospect_bridge(panel)
    prospect_forecasts = build_prospect_forecasts(arrival_preview, bridge)
    normalized_standards = normalize_jaws_standards(standards)
    return {
        "schemaVersion": PREVIEW_SCHEMA_VERSION,
        "asOf": as_of,
        "modelVersion": MODEL_VERSION,
        "targetVersion": TARGET_VERSION,
        "dataVersion": str(dict(lineage or {}).get("dataVersion", "baseball-reference-mlb-war-locked")),
        "providerVersion": "baseball-reference-mlb-war/v1",
        "status": "research_only",
        "releaseEligible": False,
        "publicationState": "research",
        "currentScoringEvaluation": {
            "crossFitted": False,
            "evaluated": False,
            "inheritsTournamentMetrics": False,
            "scope": "exact final 2022 refit used for current MLB scoring",
        },
        "metrics": tournament.report,
        "standards": [
            {
                "key": str(row["position"]),
                "label": str(row["label"]),
                "hofPlayerCount": int(row["hof_player_count"]),
                "careerWar": float(row["career_war_standard"]),
                "peakSevenWar": float(row["peak_seven_war_standard"]),
                "jaws": float(row["jaws_standard"]),
            }
            for row in normalized_standards.to_dict("records")
        ],
        "players": players,
        "prospectBridge": bridge,
        "prospectForecasts": prospect_forecasts,
        "milbAlphaSignalReport": (
            None
            if arrival_preview is None
            else arrival_preview.get("milbAlphaReport")
        ),
        "coverage": {
            "mlbCensus": census,
            "resolvedCareerPlayers": int(
                panel.loc[panel["resolved_career"], "bbref_id"].nunique()
            ),
            "careerLandmarks": int(len(panel)),
            "prospectForecasts": len(prospect_forecasts),
            "milbAlphaEligible": sum(
                forecast.get("milbAlphaSignal", {}).get("eligible") is True
                for forecast in prospect_forecasts.values()
                if isinstance(forecast.get("milbAlphaSignal"), Mapping)
            ),
        },
        "lineage": {
            **dict(lineage or {}),
            "scoringFit": scoring_bundle.lineage,
            "selectedEntrant": scoring_bundle.selected_entrant,
        },
        "disclosures": [
            "Research output only; release gates are incomplete.",
            "Hall caliber is a statistical JAWS outcome, not Hall of Fame induction probability.",
            "Champion selection used only the chronological selection cohort; the inspected development holdout is retrospective audit evidence, not prospective validation.",
            SELECTIVE_TARGET_DOMAIN_DISCLOSURE,
            "Current-player point and raw classifier learners were refit through all resolved careers while held-out residual banks and calibrators were frozen; full player-disjoint cross-fit recalibration remains pending.",
            "The exact final 2022 current-scoring refit was not cross-fitted or evaluated; current-player probabilities do not inherit the retrospective tournament metrics.",
            "2026 is an in-season census; completed-season features remain the default scoring state.",
            "Season-one-to-three Hall-event tail behavior is a failed research diagnostic; central interval coverage is descriptive, and P95/P99, expected-shortfall, and learned elite-tail evaluation are still required.",
            "Prospect forecasts combine a separately evaluated arrival research model with an MLB debut-age bridge baseline.",
            "MiLB alpha is an age-and-level-adjusted MLB-arrival ranking signal; external validation failed, no horizon is validated, and it is not a Hall-ceiling or return forecast.",
        ],
    }


def load_arrival_preview(path: Path | None) -> dict[str, Any] | None:
    if path is None or not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError("Arrival preview must contain a JSON object")
    return value


def validate_preview_sanity(payload: Mapping[str, Any]) -> None:
    players = {
        str(player.get("bbrefId")): player
        for player in payload.get("players", [])
        if isinstance(player, dict)
    }
    named = ("wittbo02", "sotoju01", "skenepa01", "hendegu01", "rodriju01")
    for player_id in named:
        player = players.get(player_id)
        if not player or player.get("publicationState") == "withheld":
            continue
        distribution = player.get("finalCareerWar")
        if not isinstance(distribution, dict):
            raise ValueError(f"Named sanity player has no final WAR distribution: {player_id}")
        width = float(distribution["p90"]) - float(distribution["p10"])
        if width < 20.0:
            raise ValueError(f"Named sanity final WAR interval is underdispersed: {player_id}")
    adjacent = [players.get("wittbo02"), players.get("hendegu01")]
    if all(player and player.get("publicationState") != "withheld" for player in adjacent):
        left, right = adjacent
        probability_gap = abs(
            float(left["hofCaliberProbability"]) - float(right["hofCaliberProbability"])
        )
        median_gap = abs(
            float(left["finalCareerWar"]["p50"])
            - float(right["finalCareerWar"]["p50"])
        )
        if probability_gap > 0.15 or median_gap > 20.0:
            raise ValueError("Adjacent young-star sanity check exposes a forecast cliff")
