from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import unicodedata
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from typing import Any

import pandas as pd

try:
    from modeling.contracts import (
        CATEGORICAL_FEATURES,
        DATA_CUTOFF,
        SURVIVAL_HORIZON_MONTHS,
        assert_feature_contract,
    )
    from modeling.provenance import file_sha256, json_sha256, producer_metadata
    from modeling.risk_set import (
        RISK_SET_CONTRACT_VERSION,
        RISK_SET_POLICY,
        build_affiliated_risk_set,
        canonicalize_baseball_reference_appearances,
    )
except ModuleNotFoundError:
    from contracts import (
        CATEGORICAL_FEATURES,
        DATA_CUTOFF,
        SURVIVAL_HORIZON_MONTHS,
        assert_feature_contract,
    )
    from provenance import file_sha256, json_sha256, producer_metadata
    from risk_set import (
        RISK_SET_CONTRACT_VERSION,
        RISK_SET_POLICY,
        build_affiliated_risk_set,
        canonicalize_baseball_reference_appearances,
    )

ROOT = Path(__file__).resolve().parents[1]
CHADWICK_VERSION = "7e23e7dfaff51b3ae72c16393703eda7e5ecad27"
FANGRAPHS_VERSION = "2017-2026-editions"
SNAPSHOT_POLICY = "edition_year_end_capped_at_acquisition_v1"
ACQUISITION_DATE = pd.Timestamp("2026-07-11")

HITTER_STATS = {
    "G": "prior_g",
    "PA": "prior_pa",
    "AB": "prior_ab",
    "HR": "prior_hr",
    "BB": "prior_bb",
    "SO": "prior_so",
    "SB": "prior_sb",
    "BB%": "prior_bb_rate",
    "K%": "prior_k_rate",
    "ISO": "prior_iso",
    "BABIP": "prior_babip",
    "wRC+": "prior_wrc_plus",
    "GB%": "prior_gb_rate",
    "LD%": "prior_ld_rate",
    "FB%": "prior_fb_rate",
    "SwStr%": "prior_swstr_rate",
}

PITCHER_STATS = {
    "G": "prior_g",
    "IP": "prior_ip",
    "TBF": "prior_tbf",
    "HR": "prior_hr",
    "BB": "prior_bb",
    "SO": "prior_so",
    "BB%": "prior_bb_rate",
    "K%": "prior_k_rate",
    "K-BB%": "prior_k_minus_bb_rate",
    "BABIP": "prior_babip",
    "ERA": "prior_era",
    "FIP": "prior_fip",
    "xFIP": "prior_xfip",
    "WHIP": "prior_whip",
    "GB%": "prior_gb_rate",
    "LD%": "prior_ld_rate",
    "FB%": "prior_fb_rate",
    "SwStr%": "prior_swstr_rate",
}

SCOUTING_NUMERIC_FIELDS = {
    "Height": "height_inches",
    "Weight": "weight_pounds",
    "Ovr_Rank": "overall_rank",
    "Org_Rank": "organization_rank",
    "FV_Current": "future_value",
    "pHit": "present_hit",
    "fHit": "future_hit",
    "pGame": "present_game_power",
    "fGame": "future_game_power",
    "pRaw": "present_raw_power",
    "fRaw": "future_raw_power",
    "pSpd": "present_speed",
    "fSpd": "future_speed",
    "pFld": "present_fielding",
    "fFld": "future_fielding",
    "pArm": "present_arm",
    "fArm": "future_arm",
    "pFB": "present_fastball",
    "fFB": "future_fastball",
    "pSL": "present_slider",
    "fSL": "future_slider",
    "pCB": "present_curveball",
    "fCB": "future_curveball",
    "pCH": "present_changeup",
    "fCH": "future_changeup",
    "pCMD": "present_command",
    "fCMD": "future_command",
}


def clean_identifier(value: Any) -> str | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    cleaned = str(value).strip()
    if not cleaned or cleaned.lower() in {"nan", "none", "null", "0"}:
        return None
    return cleaned.removesuffix(".0")


def numeric(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def categorical(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    cleaned = str(value).strip()
    if cleaned.lower() in {"", "0", "n/a", "nan", "none", "null", "-"}:
        return None
    return cleaned


def parse_date(value: Any) -> pd.Timestamp | None:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    parsed = pd.to_datetime(str(value).strip(), errors="coerce")
    return None if pd.isna(parsed) else pd.Timestamp(parsed).normalize()


def fangraphs_birth_date(value: Any) -> pd.Timestamp | None:
    serial = numeric(value)
    if serial is not None and 1 <= serial <= 80_000:
        return pd.Timestamp("1899-12-30") + pd.to_timedelta(int(serial), unit="D")
    return parse_date(value)


def normalize_name(value: Any) -> str:
    ascii_name = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode()
    tokens = re.findall(r"[a-z]+", ascii_name.lower())
    suffixes = {"jr", "sr", "ii", "iii", "iv"}
    return " ".join(token for token in tokens if token not in suffixes)


def exact_age(birth_date: pd.Timestamp | None, as_of: pd.Timestamp) -> float | None:
    if birth_date is None or birth_date > as_of:
        return None
    return round((as_of - birth_date).days / 365.2425, 4)


def parse_draft(value: Any) -> tuple[float | None, float | None, str]:
    text = str(value or "").strip()
    year_match = re.search(r"\b(19|20)\d{2}\b", text)
    round_match = re.search(r"(?:round|rd|r)\s*([0-9]+)", text, flags=re.IGNORECASE)
    if "J2" in text.upper() or "INT" in text.upper():
        acquisition_type = "international"
    elif year_match:
        acquisition_type = "draft"
    else:
        acquisition_type = "unknown"
    return (
        float(year_match.group(0)) if year_match else None,
        float(round_match.group(1)) if round_match else None,
        acquisition_type,
    )


def infer_role(position: Any) -> str:
    normalized = str(position or "").upper().replace(" ", "")
    tokens = {token for token in re.split(r"[/,;-]", normalized) if token}
    has_pitcher = "P" in tokens or normalized in {"LHP", "RHP", "SP", "RP"}
    has_hitter = any(token not in {"P", "LHP", "RHP", "SP", "RP"} for token in tokens)
    if has_pitcher and has_hitter:
        return "two_way"
    return "pitcher" if has_pitcher else "hitter"


def source_hash(path: Path) -> str:
    return file_sha256(path)


def portable_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return str(resolved.relative_to(ROOT))
    except ValueError:
        return str(resolved)


def verify_locked_raw_inputs(
    raw_root: Path, source_lock_path: Path, acquisition_manifest: Path | None = None
) -> dict[str, Any]:
    source_lock = json.loads(source_lock_path.read_text())
    expected = {
        (source, key): resource
        for source, entry in source_lock["sources"].items()
        for key, resource in entry["resources"].items()
    }
    if acquisition_manifest is not None:
        candidate = acquisition_manifest if acquisition_manifest.is_absolute() else ROOT / acquisition_manifest
        candidates = [candidate]
    else:
        candidates = sorted((ROOT / "data/manifests/runs").glob("*.json"), reverse=True)

    current_lock_sha256 = source_hash(source_lock_path)
    selected_path: Path | None = None
    selected: dict[str, Any] | None = None
    for candidate in candidates:
        try:
            manifest = json.loads(candidate.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            if acquisition_manifest is not None:
                raise ValueError(f"Acquisition manifest is missing or invalid: {candidate}")
            continue
        resources = manifest.get("resources", [])
        keys = [(resource.get("source"), resource.get("key")) for resource in resources]
        if (
            manifest.get("sourceLock", {}).get("sha256") == current_lock_sha256
            and len(keys) == len(expected)
            and len(set(keys)) == len(keys)
            and set(keys) == set(expected)
        ):
            selected_path = candidate
            selected = manifest
            break

    if selected_path is None or selected is None:
        raise ValueError(
            "No complete acquisition manifest matches data/source-lock.json; run npm run data:acquire"
        )

    resolved_raw_root = raw_root.resolve()
    for resource in selected["resources"]:
        key = (resource["source"], resource["key"])
        locked = expected[key]
        if any(resource[field] != locked[field] for field in ("bytes", "sha256", "url")):
            raise ValueError(f"Acquisition evidence differs from the source lock: {key}")
        resource_path = Path(resource["path"])
        if not resource_path.is_absolute():
            resource_path = ROOT / resource_path
        resolved_resource = resource_path.resolve()
        if not resolved_resource.is_relative_to(resolved_raw_root):
            raise ValueError(f"Acquired resource is outside the selected raw root: {resource_path}")
        if (
            not resolved_resource.exists()
            or resolved_resource.stat().st_size != locked["bytes"]
            or source_hash(resolved_resource) != locked["sha256"]
        ):
            raise ValueError(f"Locked raw input is missing or modified: {resource_path}")

    return {
        "path": portable_path(selected_path),
        "sha256": source_hash(selected_path),
        "acquired_at": selected.get("acquiredAt"),
        "source_lock_sha256": current_lock_sha256,
        "resources": len(expected),
    }


def load_chadwick(raw_root: Path) -> pd.DataFrame:
    columns = [
        "key_uuid",
        "key_mlbam",
        "key_retro",
        "key_bbref",
        "key_bbref_minors",
        "key_fangraphs",
        "name_first",
        "name_last",
        "name_suffix",
        "birth_year",
        "birth_month",
        "birth_day",
        "mlb_played_first",
        "mlb_played_last",
    ]
    base = raw_root / "chadwick-register" / CHADWICK_VERSION / "data"
    shards = sorted(base.glob("people-?.csv"))
    if len(shards) != 16:
        raise FileNotFoundError(f"Expected 16 Chadwick shards in {base}, found {len(shards)}")
    frames = [pd.read_csv(shard, dtype=str, usecols=columns, low_memory=False) for shard in shards]
    register = pd.concat(frames, ignore_index=True)
    for column in ("key_uuid", "key_mlbam", "key_retro", "key_bbref", "key_bbref_minors", "key_fangraphs"):
        register[column] = register[column].map(clean_identifier)

    date_parts = register[["birth_year", "birth_month", "birth_day"]].apply(
        pd.to_numeric, errors="coerce"
    )
    register["birth_date"] = pd.to_datetime(
        {"year": date_parts.birth_year, "month": date_parts.birth_month, "day": date_parts.birth_day},
        errors="coerce",
    )
    register["normalized_name"] = register.apply(
        lambda row: normalize_name(f"{row.get('name_first', '')} {row.get('name_last', '')} {row.get('name_suffix', '')}"),
        axis=1,
    )
    return register.drop_duplicates("key_uuid", keep="last")


def identity_indexes(register: pd.DataFrame) -> dict[str, dict[str, dict[str, Any]]]:
    indexes: dict[str, dict[str, dict[str, Any]]] = {}
    for namespace in ("key_fangraphs", "key_mlbam", "key_bbref_minors"):
        populated = register[register[namespace].notna()].copy()
        unique = populated[~populated[namespace].duplicated(keep=False)]
        indexes[namespace] = {
            str(row[namespace]): row.to_dict() for _, row in unique.iterrows()
        }
    register = register[register["birth_date"].notna() & register["normalized_name"].ne("")].copy()
    register["name_birth"] = register.apply(
        lambda row: f"{row['normalized_name']}|{pd.Timestamp(row['birth_date']).date().isoformat()}", axis=1
    )
    unique_biography = register[~register["name_birth"].duplicated(keep=False)]
    indexes["name_birth"] = {
        str(row["name_birth"]): row.to_dict() for _, row in unique_biography.iterrows()
    }
    return indexes


def find_identity(
    record: dict[str, Any], indexes: dict[str, dict[str, dict[str, Any]]]
) -> tuple[dict[str, Any] | None, str | None]:
    candidates = (
        ("key_fangraphs", clean_identifier(record.get("PlayerId") or record.get("UPID"))),
        ("key_mlbam", clean_identifier(record.get("xMLBAMID"))),
        ("key_bbref_minors", clean_identifier(record.get("minorMasterId"))),
    )
    matches = [indexes[key][value] for key, value in candidates if value and value in indexes[key]]
    if matches:
        uuids = {match["key_uuid"] for match in matches}
        return (matches[0], "cross_source_id") if len(uuids) == 1 else (None, "id_collision")

    birth_date = fangraphs_birth_date(record.get("BirthDate"))
    player_name = record.get("playerName") or " ".join(
        filter(None, (record.get("FirstName"), record.get("LastName")))
    )
    if birth_date is not None:
        key = f"{normalize_name(player_name)}|{birth_date.date().isoformat()}"
        if key in indexes["name_birth"]:
            return indexes["name_birth"][key], "unique_name_birth_date"
    return None, None


def stats_index(records: list[dict[str, Any]], opportunity: str) -> dict[str, dict[str, Any]]:
    selected: dict[str, dict[str, Any]] = {}
    for record in records:
        key = clean_identifier(record.get("UPID") or record.get("playerids"))
        if key is None:
            continue
        current = selected.get(key)
        if current is None or (numeric(record.get(opportunity)) or 0) > (
            numeric(current.get(opportunity)) or 0
        ):
            selected[key] = record
    return selected


def load_fangraphs_snapshots(raw_root: Path, register: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, int]]:
    base = raw_root / "fangraphs-prospect-board" / FANGRAPHS_VERSION
    indexes = identity_indexes(register)
    rows: list[dict[str, Any]] = []
    quality = {
        "scouting_rows": 0,
        "matched_cross_source_id": 0,
        "quarantined_name_birth_candidates": 0,
        "identity_collisions": 0,
        "unmatched_identities": 0,
    }

    for edition in range(2017, 2027):
        bat_path = base / f"{edition}-bat.json"
        pit_path = base / f"{edition}-pit.json"
        if not bat_path.exists() or not pit_path.exists():
            raise FileNotFoundError(f"Missing FanGraphs edition {edition}; run npm run data:acquire")
        bat = json.loads(bat_path.read_text())
        pit = json.loads(pit_path.read_text())
        bat_scout = bat.get("dataScout", [])
        pit_scout = pit.get("dataScout", [])
        scout_records = [(record, "hitter") for record in bat_scout] + [
            (record, "pitcher") for record in pit_scout
        ]
        if {int(record["Season"]) for record, _ in scout_records} != {edition}:
            raise ValueError(f"FanGraphs edition validation failed for {edition}")
        bat_stats = stats_index(bat.get("dataStats", []), "PA")
        pit_stats = stats_index(pit.get("dataStats", []), "TBF")
        quality["scouting_rows"] += len(scout_records)

        as_of = min(pd.Timestamp(date(edition, 12, 31)), ACQUISITION_DATE)
        for scout, role in scout_records:
            fg_id = clean_identifier(scout.get("PlayerId") or scout.get("UPID"))
            if fg_id is None:
                quality["unmatched_identities"] += 1
                continue
            stat = (pit_stats if role == "pitcher" else bat_stats).get(fg_id, {})
            identity_record = dict(scout)
            identity_record["xMLBAMID"] = stat.get("xMLBAMID")
            identity, identity_method = find_identity(identity_record, indexes)
            if identity is None:
                if identity_method == "id_collision":
                    quality["identity_collisions"] += 1
                quality["unmatched_identities"] += 1
                continue
            if identity_method == "unique_name_birth_date":
                quality["quarantined_name_birth_candidates"] += 1
                continue
            quality[f"matched_{identity_method}"] += 1
            position = scout.get("Position") or scout.get("positionDB")
            expected_stat_season = edition - 1
            if stat and numeric(stat.get("Season")) != expected_stat_season:
                raise ValueError(f"Unexpected prior-stat season for edition {edition}, player {fg_id}")

            draft_year, draft_round, acquisition_type = parse_draft(scout.get("Draft"))
            eta = numeric(scout.get("cETA") or scout.get("ETA_Current"))
            birth_date = parse_date(identity.get("birth_date"))
            row: dict[str, Any] = {
                "snapshot_id": f"fg:{edition}:{fg_id}:{role}",
                "player_id": identity["key_uuid"],
                "fangraphs_id": fg_id,
                "mlbam_id": clean_identifier(identity.get("key_mlbam")),
                "bbref_id": clean_identifier(identity.get("key_bbref")),
                "player_name": scout.get("playerName")
                or " ".join(filter(None, (scout.get("FirstName"), scout.get("LastName")))),
                "edition": edition,
                "as_of": as_of,
                "availability_quality": "edition_only_conservative_year_end",
                "identity_method": identity_method,
                "role": role,
                "position": position,
                "organization": scout.get("Team") or scout.get("cOrg"),
                "bats": scout.get("Bats"),
                "throws": scout.get("Throws"),
                "risk": scout.get("cRisk") or scout.get("Risk_Current"),
                "variance": scout.get("Variance"),
                "prior_level": stat.get("level") or stat.get("aLevel"),
                "prior_season": expected_stat_season,
                "age": exact_age(birth_date, as_of),
                "eta_years": eta - edition if eta is not None else None,
                "draft_year": draft_year,
                "draft_round": draft_round,
                "acquisition_type": acquisition_type,
            }
            for source, target in SCOUTING_NUMERIC_FIELDS.items():
                row[target] = numeric(scout.get(source))
            row["overall_rank"] = numeric(scout.get("cOVR")) or row["overall_rank"]
            row["organization_rank"] = numeric(scout.get("cORG")) or row["organization_rank"]
            row["future_value"] = numeric(scout.get("cFV")) or row["future_value"]
            stat_fields = PITCHER_STATS if role == "pitcher" else HITTER_STATS
            for source, target in stat_fields.items():
                row[target] = numeric(stat.get(source))
            rows.append(row)

    snapshots = pd.DataFrame(rows).drop_duplicates("snapshot_id", keep="last")
    for column in set(SCOUTING_NUMERIC_FIELDS.values()) | set(HITTER_STATS.values()) | set(PITCHER_STATS.values()):
        if column not in snapshots:
            snapshots[column] = pd.NA
    for column in CATEGORICAL_FEATURES:
        snapshots[column] = snapshots[column].map(categorical)
    assert_feature_contract(snapshots.columns.tolist())
    return snapshots, quality


def load_lahman(raw_root: Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    base = raw_root / "sabr-lahman" / "2025"
    people = pd.read_csv(base / "People.csv", dtype=str, low_memory=False)
    batting = pd.read_csv(base / "Batting.csv", dtype=str, low_memory=False)
    pitching = pd.read_csv(base / "Pitching.csv", dtype=str, low_memory=False)
    hall = pd.read_csv(base / "HallOfFame.csv", dtype=str, low_memory=False)
    return people, batting, pitching, hall


def load_retrosheet_debuts(raw_root: Path) -> dict[str, pd.Timestamp]:
    path = (
        raw_root
        / "retrosheet"
        / "bf5af7d40e1f0c33026074705cda8ed1c5177f95"
        / "reference/biofile0.csv"
    )
    biographies = pd.read_csv(path, dtype=str, usecols=["id", "debut_p"], low_memory=False)
    biographies["debut_date"] = pd.to_datetime(
        biographies["debut_p"], format="%Y%m%d", errors="coerce"
    )
    return {
        str(row["id"]): pd.Timestamp(row["debut_date"])
        for _, row in biographies[biographies["debut_date"].notna()].iterrows()
    }


def build_labels(
    snapshots: pd.DataFrame,
    people: pd.DataFrame,
    register: pd.DataFrame,
    retrosheet_debuts: dict[str, pd.Timestamp],
    exclusion_reasons: dict[str, str] | None = None,
) -> tuple[pd.DataFrame, dict[str, int]]:
    identified = people[people["bbrefID"].notna()].copy()
    identified["bbrefID"] = identified["bbrefID"].map(clean_identifier)
    collisions = set(
        identified.loc[identified["bbrefID"].duplicated(keep=False), "bbrefID"].dropna()
    )
    debut_by_bbref = {
        str(row["bbrefID"]): parse_date(row.get("debut"))
        for _, row in identified[~identified["bbrefID"].isin(collisions)].iterrows()
    }
    register_by_uuid = register.set_index("key_uuid").to_dict("index")
    cutoff = pd.Timestamp(DATA_CUTOFF)
    labels: list[dict[str, Any]] = []
    quality = {
        "dual_source_exact_matches": 0,
        "dual_source_disagreements": 0,
        "retrosheet_fallbacks": 0,
        "lahman_bbref_collisions": len(collisions),
        "pre_snapshot_debuts_removed": 0,
        "missing_exact_debut_quarantined": 0,
        "source_disagreements_quarantined": 0,
    }
    for row in snapshots.to_dict("records"):
        as_of = pd.Timestamp(row["as_of"])
        lahman_debut = debut_by_bbref.get(clean_identifier(row.get("bbref_id")))
        identity = register_by_uuid.get(row["player_id"], {})
        retro_debut = retrosheet_debuts.get(clean_identifier(identity.get("key_retro")) or "")
        if lahman_debut is not None and retro_debut is not None:
            if lahman_debut == retro_debut:
                quality["dual_source_exact_matches"] += 1
            else:
                quality["dual_source_disagreements"] += 1
                quality["source_disagreements_quarantined"] += 1
                if exclusion_reasons is not None:
                    exclusion_reasons[row["snapshot_id"]] = (
                        "source_debut_disagreement"
                    )
                continue
        debut = lahman_debut if lahman_debut is not None else retro_debut
        debut_source = "lahman+retrosheet" if lahman_debut == retro_debut and debut is not None else (
            "lahman" if lahman_debut is not None else "retrosheet" if retro_debut is not None else None
        )
        if lahman_debut is None and retro_debut is not None:
            quality["retrosheet_fallbacks"] += 1
        if debut is not None and debut <= as_of:
            quality["pre_snapshot_debuts_removed"] += 1
            if exclusion_reasons is not None:
                exclusion_reasons[row["snapshot_id"]] = "pre_snapshot_debut"
            continue
        mlb_first_year = numeric(identity.get("mlb_played_first"))
        if debut is None and mlb_first_year is not None and mlb_first_year <= int(DATA_CUTOFF[:4]):
            quality["missing_exact_debut_quarantined"] += 1
            if exclusion_reasons is not None:
                exclusion_reasons[row["snapshot_id"]] = "missing_exact_debut"
            continue
        label: dict[str, Any] = {
            "snapshot_id": row["snapshot_id"],
            "player_id": row["player_id"],
            "as_of": as_of,
            "debut_date": debut,
            "debut_source": debut_source,
            "data_cutoff": cutoff,
            "censor_state": "event" if debut is not None and debut <= cutoff else "right_censored",
        }
        for months in SURVIVAL_HORIZON_MONTHS:
            horizon_end = as_of + pd.DateOffset(months=months)
            event_observed = bool(
                debut is not None and debut <= min(horizon_end, cutoff)
            )
            observed = bool(event_observed or horizon_end <= cutoff)
            label[f"observed_{months}m"] = observed
            label[f"debut_within_{months}m"] = (
                event_observed if observed else pd.NA
            )
        labels.append(label)
    label_frame = pd.DataFrame(labels)
    for column in ("as_of", "debut_date", "data_cutoff"):
        label_frame[column] = pd.to_datetime(label_frame[column])
    for months in SURVIVAL_HORIZON_MONTHS:
        label_frame[f"observed_{months}m"] = label_frame[
            f"observed_{months}m"
        ].astype("boolean")
        label_frame[f"debut_within_{months}m"] = label_frame[
            f"debut_within_{months}m"
        ].astype("boolean")
    return label_frame, quality


def lahman_player_ids(register: pd.DataFrame, people: pd.DataFrame) -> dict[str, str]:
    namespace_maps: dict[str, dict[str, str]] = {}
    for namespace in ("key_bbref", "key_retro"):
        populated = register[register[namespace].notna()].copy()
        unique = populated[~populated[namespace].duplicated(keep=False)]
        namespace_maps[namespace] = {
            str(row[namespace]): str(row["key_uuid"]) for _, row in unique.iterrows()
        }

    player_ids: dict[str, str] = {}
    for _, row in people.iterrows():
        lahman_id = clean_identifier(row.get("playerID"))
        if lahman_id is None:
            continue
        bbref_id = clean_identifier(row.get("bbrefID"))
        retro_id = clean_identifier(row.get("retroID"))
        player_id = namespace_maps["key_bbref"].get(bbref_id) if bbref_id is not None else None
        if player_id is None and retro_id is not None:
            player_id = namespace_maps["key_retro"].get(retro_id)
        if player_id is not None:
            player_ids[lahman_id] = player_id

    identity_counts = Counter(player_ids.values())
    ambiguous_uuids = {
        player_id for player_id, count in identity_counts.items() if count > 1
    }
    return {
        lahman_id: player_id
        for lahman_id, player_id in player_ids.items()
        if player_id not in ambiguous_uuids
    }


def aggregate_career_outcomes(
    people: pd.DataFrame,
    batting: pd.DataFrame,
    pitching: pd.DataFrame,
    hall: pd.DataFrame,
    player_ids: dict[str, str],
) -> pd.DataFrame:
    numeric_batting = ["G", "AB", "R", "H", "2B", "3B", "HR", "RBI", "SB", "BB", "SO", "HBP", "SF"]
    numeric_pitching = ["W", "L", "G", "GS", "CG", "SHO", "SV", "IPouts", "H", "ER", "HR", "BB", "SO"]
    for column in numeric_batting:
        batting[column] = pd.to_numeric(batting.get(column), errors="coerce").fillna(0)
    for column in numeric_pitching:
        pitching[column] = pd.to_numeric(pitching.get(column), errors="coerce").fillna(0)

    bat = batting.groupby("playerID", as_index=False)[numeric_batting].sum()
    bat = bat.rename(columns={column: f"batting_{column.lower()}" for column in numeric_batting})
    pit = pitching.groupby("playerID", as_index=False)[numeric_pitching].sum()
    pit = pit.rename(columns={column: f"pitching_{column.lower()}" for column in numeric_pitching})
    player_inductions = hall.loc[
        (hall.get("inducted") == "Y") & (hall.get("category") == "Player")
    ].copy()
    if not player_inductions.empty and "yearid" not in player_inductions:
        raise ValueError("Hall of Fame player induction rows require a numeric yearid")
    player_inductions["source_hall_of_fame_induction_year"] = pd.to_numeric(
        player_inductions.get("yearid"), errors="coerce"
    )
    if player_inductions["source_hall_of_fame_induction_year"].isna().any():
        raise ValueError("Hall of Fame player induction rows require a numeric yearid")
    induction_year_by_player = (
        player_inductions.dropna(subset=["playerID"])
        .groupby("playerID")["source_hall_of_fame_induction_year"]
        .min()
        .astype(int)
        .to_dict()
    )
    latest_batting = pd.to_numeric(batting["yearID"], errors="coerce").groupby(batting["playerID"]).max()
    latest_pitching = pd.to_numeric(pitching["yearID"], errors="coerce").groupby(pitching["playerID"]).max()
    latest_season = pd.concat([latest_batting, latest_pitching], axis=1).max(axis=1)
    outcomes = people[["playerID", "bbrefID", "debut", "finalGame"]].copy()
    outcomes = outcomes.merge(bat, on="playerID", how="left").merge(pit, on="playerID", how="left")
    outcomes["last_observed_season"] = outcomes["playerID"].map(latest_season)
    outcomes["source_hall_of_fame_induction_year"] = pd.array(
        outcomes["playerID"].map(induction_year_by_player), dtype="Int64"
    )
    outcomes["hall_of_fame_outcome_state"] = "active_or_recent_not_inducted_censored"
    inactive = outcomes["last_observed_season"].le(int(DATA_CUTOFF[:4]) - 5)
    outcomes.loc[inactive, "hall_of_fame_outcome_state"] = "inactive_not_inducted_censored"
    inducted_mask = outcomes["source_hall_of_fame_induction_year"].le(
        int(DATA_CUTOFF[:4])
    ).fillna(False)
    outcomes.loc[inducted_mask, "hall_of_fame_outcome_state"] = "inducted"
    outcomes["hall_of_fame_inducted"] = pd.Series(pd.NA, index=outcomes.index, dtype="boolean")
    outcomes.loc[inducted_mask, "hall_of_fame_inducted"] = True
    outcomes["debut"] = pd.to_datetime(outcomes["debut"], errors="coerce")
    outcomes["source_final_game"] = pd.to_datetime(outcomes["finalGame"], errors="coerce")
    outcomes["career_resolution"] = "right_censored"
    resolved = outcomes["last_observed_season"].le(int(DATA_CUTOFF[:4]) - 3)
    outcomes.loc[resolved, "career_resolution"] = "three_year_inactivity_proxy"
    outcomes.loc[outcomes["last_observed_season"].isna(), "career_resolution"] = "unobserved"
    final_game_consistent = (
        outcomes["source_final_game"].dt.year >= outcomes["last_observed_season"]
    )
    outcomes["final_game"] = outcomes["source_final_game"].where(
        resolved & final_game_consistent
    )
    outcomes["career_days"] = (outcomes["final_game"] - outcomes["debut"]).dt.days
    outcomes["followup_through"] = pd.Timestamp(DATA_CUTOFF)
    outcomes["player_id"] = outcomes["playerID"].map(player_ids)
    return outcomes.drop(columns="finalGame").rename(
        columns={"playerID": "lahman_id", "bbrefID": "bbref_id"}
    )


def build_career_landmarks(
    people: pd.DataFrame,
    batting: pd.DataFrame,
    pitching: pd.DataFrame,
    player_ids: dict[str, str],
) -> tuple[pd.DataFrame, pd.DataFrame]:
    batting_fields = ["G", "AB", "H", "2B", "3B", "HR", "SB", "BB", "SO", "HBP", "SH", "SF"]
    pitching_fields = ["W", "L", "G", "GS", "SV", "IPouts", "H", "ER", "HR", "BB", "SO"]
    for field in batting_fields:
        batting[field] = pd.to_numeric(batting.get(field), errors="coerce").fillna(0)
    for field in pitching_fields:
        pitching[field] = pd.to_numeric(pitching.get(field), errors="coerce").fillna(0)

    bat = batting.groupby(["playerID", "yearID"], as_index=False)[batting_fields].sum()
    bat["PA"] = bat[["AB", "BB", "HBP", "SH", "SF"]].sum(axis=1)
    bat = bat.rename(
        columns={field: f"season_batting_{field.lower()}" for field in batting_fields + ["PA"]}
    )
    pit = pitching.groupby(["playerID", "yearID"], as_index=False)[pitching_fields].sum()
    pit = pit.rename(columns={field: f"season_pitching_{field.lower()}" for field in pitching_fields})
    seasons = bat.merge(pit, on=["playerID", "yearID"], how="outer")
    stat_columns = [column for column in seasons if column.startswith("season_")]
    seasons[stat_columns] = seasons[stat_columns].fillna(0)
    seasons["season"] = pd.to_numeric(seasons["yearID"], errors="raise").astype(int)
    seasons = seasons.drop(columns="yearID").sort_values(["playerID", "season"])

    bio = people[["playerID", "bbrefID", "birthYear", "birthMonth", "birthDay", "debut"]].copy()
    parts = bio[["birthYear", "birthMonth", "birthDay"]].apply(pd.to_numeric, errors="coerce")
    bio["birth_date"] = pd.to_datetime(
        {"year": parts.birthYear, "month": parts.birthMonth, "day": parts.birthDay}, errors="coerce"
    )
    bio["debut_date"] = pd.to_datetime(bio["debut"], errors="coerce")
    seasons = seasons.merge(
        bio[["playerID", "bbrefID", "birth_date", "debut_date"]], on="playerID", how="left"
    )
    midpoint = pd.to_datetime(seasons["season"].astype(str) + "-07-01")
    seasons["age_midseason"] = (midpoint - seasons["birth_date"]).dt.days / 365.2425
    seasons["role"] = "hitter"
    has_pitching = seasons["season_pitching_ipouts"] > 0
    has_batting = seasons["season_batting_pa"] > 0
    seasons.loc[has_pitching & ~has_batting, "role"] = "pitcher"
    seasons.loc[has_pitching & has_batting, "role"] = "two_way"
    seasons["seasons_played_to_date"] = seasons.groupby("playerID").cumcount() + 1

    cumulative_columns: list[str] = []
    for column in stat_columns:
        cumulative = column.replace("season_", "career_to_date_", 1)
        seasons[cumulative] = seasons.groupby("playerID")[column].cumsum()
        cumulative_columns.append(cumulative)

    final_season = seasons.groupby("playerID")["season"].transform("max")
    total_seasons = seasons.groupby("playerID")["season"].transform("size")
    total_batting_pa = seasons.groupby("playerID")["season_batting_pa"].transform("sum")
    total_pitching_outs = seasons.groupby("playerID")["season_pitching_ipouts"].transform("sum")
    labels = seasons[["playerID", "bbrefID", "season"]].copy()
    labels["appeared_next_season"] = (
        seasons.groupby("playerID")["season"]
        .shift(-1)
        .eq(seasons["season"] + 1)
        .astype("boolean")
    )
    labels.loc[seasons["season"] >= int(DATA_CUTOFF[:4]), "appeared_next_season"] = pd.NA
    labels["future_active_seasons"] = total_seasons - seasons["seasons_played_to_date"]
    labels["remaining_batting_pa"] = total_batting_pa - seasons["career_to_date_batting_pa"]
    labels["remaining_pitching_outs"] = (
        total_pitching_outs - seasons["career_to_date_pitching_ipouts"]
    )
    labels["final_season"] = final_season
    labels["outcome_cutoff"] = DATA_CUTOFF
    labels["career_resolution"] = "three_year_inactivity_proxy"
    labels.loc[final_season > int(DATA_CUTOFF[:4]) - 3, "career_resolution"] = "right_censored"

    features = seasons.drop(columns=["birth_date", "debut_date"])
    forbidden = ("remaining_", "future_", "final_", "appeared_next", "outcome_", "resolution")
    leaked = [column for column in features if any(token in column for token in forbidden)]
    if leaked:
        raise ValueError(f"Career label leakage into landmark features: {leaked}")
    features["player_id"] = features["playerID"].map(player_ids)
    labels["player_id"] = labels["playerID"].map(player_ids)
    features = features.rename(columns={"playerID": "lahman_id", "bbrefID": "bbref_id"})
    labels = labels.rename(columns={"playerID": "lahman_id", "bbrefID": "bbref_id"})
    return features, labels


def write_table(frame: pd.DataFrame, path: Path) -> dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_parquet(path, index=False)
    return {"path": portable_path(path), "rows": len(frame), "sha256": source_hash(path)}


def read_canonical_table(path: Path) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path, dtype=str, low_memory=False)
    if suffix in {".parquet", ".pq"}:
        return pd.read_parquet(path)
    raise ValueError(f"Canonical model input must be CSV or Parquet: {path}")


def canonical_input_evidence(path: Path, frame: pd.DataFrame) -> dict[str, Any]:
    return {
        "path": portable_path(path),
        "rows": int(len(frame)),
        "bytes": path.stat().st_size,
        "sha256": source_hash(path),
    }


def source_universe_manifest_metadata(
    census_rows: pd.DataFrame,
) -> dict[str, Any]:
    required = {"cohort_basis", "source_universe_scope"}
    missing = sorted(required - set(census_rows.columns))
    if missing:
        raise ValueError(
            f"Affiliated census rows are missing source-universe columns: {missing}"
        )
    if census_rows.empty:
        raise ValueError("Affiliated census rows cannot be empty")
    lineage = census_rows[["cohort_basis", "source_universe_scope"]].copy()
    if lineage.isna().any().any():
        raise ValueError("Affiliated census rows contain missing source-universe lineage")
    lineage = lineage.astype(str).drop_duplicates()

    details: list[dict[str, str]] = []
    for cohort_basis, group in lineage.groupby("cohort_basis", sort=True):
        scopes = sorted(group["source_universe_scope"].unique())
        expected_scope = f"full_{cohort_basis}_census"
        if scopes != [expected_scope]:
            raise ValueError(
                f"cohort_basis {cohort_basis} requires source_universe_scope "
                f"{expected_scope}"
            )
        details.append(
            {
                "cohort_basis": cohort_basis,
                "source_universe_scope": expected_scope,
            }
        )

    if len(details) == 1:
        return {"source_universe_scope": details[0]["source_universe_scope"]}
    return {
        "source_universe_scope": "mixed_affiliated_census_scopes",
        "source_universe_scopes": details,
    }


def affiliated_release_blockers(
    *, using_bref_adapter: bool, unresolved_identity_rows: int
) -> list[str]:
    blockers = [
        (
            "Baseball-Reference prepared inputs are content-hashed, but this "
            "dataset manifest does not yet verify their matching versioned season archive lock."
            if using_bref_adapter
            else "Canonical MiLB inputs are content-hashed but are not yet verified "
            "by the acquisition source lock."
        )
    ]
    if unresolved_identity_rows > 0:
        blockers.append(
            f"{unresolved_identity_rows} affiliated census identities are unresolved; "
            "an acceptance threshold has not been approved."
        )
    blockers.extend(
        [
            "Historical source values are effective-time safe but knowledge-time unverified.",
            "The affiliated-cohort model has not yet completed temporal calibration "
            "and validation.",
        ]
    )
    return blockers


def archive_dataset_outputs(
    outputs: dict[str, dict[str, Any]], output_dir: Path, dataset_content_sha256: str
) -> None:
    archive_root = output_dir / "datasets" / dataset_content_sha256
    archive_root.mkdir(parents=True, exist_ok=True)
    for name, output in outputs.items():
        source = Path(output["path"])
        if not source.is_absolute():
            source = ROOT / source
        archive = archive_root / f"{name}.parquet"
        if archive.exists() and source_hash(archive) != output["sha256"]:
            raise ValueError(f"Archived dataset output has changed: {archive}")
        if not archive.exists():
            shutil.copyfile(source, archive)
        if source_hash(archive) != output["sha256"]:
            raise ValueError(f"Archived dataset output failed verification: {archive}")
        output["content_addressed_path"] = portable_path(archive)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build leakage-audited model tables")
    parser.add_argument("--raw-root", type=Path, default=ROOT / "data/raw")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data/processed/model-v1")
    parser.add_argument("--acquisition-manifest", type=Path)
    parser.add_argument("--milb-census-metadata", type=Path)
    parser.add_argument("--milb-roster-census", type=Path)
    parser.add_argument("--milb-player-seasons", type=Path)
    parser.add_argument("--bref-player-team-seasons", type=Path)
    parser.add_argument("--bref-quality", type=Path)
    parser.add_argument("--bref-teams", type=Path)
    parser.add_argument("--bref-team-organizations", type=Path)
    args = parser.parse_args()

    risk_set_paths = (
        args.milb_census_metadata,
        args.milb_roster_census,
        args.milb_player_seasons,
    )
    if any(risk_set_paths) and not all(risk_set_paths):
        parser.error(
            "--milb-census-metadata, --milb-roster-census, and "
            "--milb-player-seasons must be supplied together"
        )
    bref_paths = (
        args.bref_player_team_seasons,
        args.bref_quality,
        args.bref_teams,
        args.bref_team_organizations,
    )
    if any(bref_paths) and not all(bref_paths):
        parser.error(
            "--bref-player-team-seasons, --bref-quality, --bref-teams, and "
            "--bref-team-organizations must be supplied together"
        )
    if all(risk_set_paths) and all(bref_paths):
        parser.error("Canonical MiLB inputs and Baseball-Reference adapter inputs are exclusive")

    source_lock = ROOT / "data/source-lock.json"
    acquisition_evidence = verify_locked_raw_inputs(
        args.raw_root, source_lock, args.acquisition_manifest
    )
    register = load_chadwick(args.raw_root)
    snapshots, identity_quality = load_fangraphs_snapshots(args.raw_root, register)
    people, batting, pitching, hall = load_lahman(args.raw_root)
    retrosheet_debuts = load_retrosheet_debuts(args.raw_root)
    labels, label_quality = build_labels(snapshots, people, register, retrosheet_debuts)
    eligible_ids = set(labels["snapshot_id"])
    snapshots = snapshots[snapshots["snapshot_id"].isin(eligible_ids)].copy()
    player_ids = lahman_player_ids(register, people)
    career_outcomes = aggregate_career_outcomes(people, batting, pitching, hall, player_ids)
    career_landmarks, career_labels = build_career_landmarks(people, batting, pitching, player_ids)

    outputs = {
        "prospect_snapshots": write_table(snapshots, args.output_dir / "prospect_snapshots.parquet"),
        "arrival_labels": write_table(labels, args.output_dir / "arrival_labels.parquet"),
        "career_outcomes": write_table(career_outcomes, args.output_dir / "career_outcomes.parquet"),
        "career_landmarks": write_table(career_landmarks, args.output_dir / "career_landmarks.parquet"),
        "career_labels": write_table(career_labels, args.output_dir / "career_labels.parquet"),
    }
    risk_set_manifest: dict[str, Any] | None = None
    if all(risk_set_paths) or all(bref_paths):
        if all(bref_paths):
            bref_player_team_seasons = read_canonical_table(
                args.bref_player_team_seasons
            )
            bref_quality = json.loads(args.bref_quality.read_text())
            bref_teams = read_canonical_table(args.bref_teams)
            bref_team_organizations = read_canonical_table(
                args.bref_team_organizations
            )
            census_metadata, roster_census, player_seasons = (
                canonicalize_baseball_reference_appearances(
                    bref_player_team_seasons,
                    bref_quality,
                    bref_teams,
                    bref_team_organizations,
                )
            )
            risk_set_input_evidence = {
                "bref_player_team_seasons": canonical_input_evidence(
                    args.bref_player_team_seasons,
                    bref_player_team_seasons,
                ),
                "bref_quality": canonical_input_evidence(
                    args.bref_quality,
                    pd.DataFrame([bref_quality]),
                ),
                "bref_teams": canonical_input_evidence(
                    args.bref_teams,
                    bref_teams,
                ),
                "bref_team_organizations": canonical_input_evidence(
                    args.bref_team_organizations,
                    bref_team_organizations,
                ),
            }
        else:
            census_metadata = read_canonical_table(args.milb_census_metadata)
            roster_census = read_canonical_table(args.milb_roster_census)
            player_seasons = read_canonical_table(args.milb_player_seasons)
            risk_set_input_evidence = {
                "census_metadata": canonical_input_evidence(
                    args.milb_census_metadata, census_metadata
                ),
                "roster_census": canonical_input_evidence(
                    args.milb_roster_census, roster_census
                ),
                "player_seasons": canonical_input_evidence(
                    args.milb_player_seasons, player_seasons
                ),
            }
        risk_set_census, risk_set_quality = build_affiliated_risk_set(
            census_metadata,
            roster_census,
            player_seasons,
            register,
        )
        resolved_risk_set = risk_set_census[risk_set_census["player_id"].notna()].copy()
        risk_set_label_exclusions: dict[str, str] = {}
        all_risk_set_labels, risk_set_label_quality = build_labels(
            resolved_risk_set,
            people,
            register,
            retrosheet_debuts,
            risk_set_label_exclusions,
        )
        if all_risk_set_labels.empty:
            raise ValueError("Canonical MiLB census produced no outcome-linkable at-risk rows")
        label_eligible_ids = set(all_risk_set_labels["snapshot_id"])
        supported_feature_ids = set(
            risk_set_census.loc[
                risk_set_census["feature_support_status"] == "supported",
                "snapshot_id",
            ]
        )
        eligible_risk_set_ids = label_eligible_ids & supported_feature_ids
        risk_set_labels = all_risk_set_labels[
            all_risk_set_labels["snapshot_id"].isin(eligible_risk_set_ids)
        ].copy()
        risk_set_census["model_eligible"] = risk_set_census["snapshot_id"].isin(
            eligible_risk_set_ids
        )
        risk_set_census["model_exclusion_reason"] = pd.NA
        unresolved = risk_set_census["player_id"].isna()
        risk_set_census.loc[unresolved, "model_exclusion_reason"] = "unresolved_identity"
        risk_set_census["model_exclusion_reason"] = risk_set_census.apply(
            lambda row: risk_set_label_exclusions.get(
                row["snapshot_id"], row["model_exclusion_reason"]
            ),
            axis=1,
        )
        unsupported = (
            risk_set_census["model_exclusion_reason"].isna()
            & risk_set_census["feature_support_status"].ne("supported")
        )
        risk_set_census.loc[
            unsupported, "model_exclusion_reason"
        ] = "unsupported_two_way_feature_contract"
        unexplained = (
            ~risk_set_census["model_eligible"]
            & risk_set_census["model_exclusion_reason"].isna()
        )
        risk_set_census.loc[
            unexplained, "model_exclusion_reason"
        ] = "outcome_linkage_unexplained"
        risk_set_census.loc[
            risk_set_census["model_eligible"], "model_analysis_scope"
        ] = "mlb_naive_outcome_linked_supported_features"
        risk_set_snapshots = risk_set_census[risk_set_census["model_eligible"]].copy()
        exclusion_counts = {
            str(reason): int(count)
            for reason, count in risk_set_census.loc[
                ~risk_set_census["model_eligible"], "model_exclusion_reason"
            ].value_counts().items()
        }
        risk_set_quality["outcome_linkable_rows"] = int(len(all_risk_set_labels))
        risk_set_quality["model_exclusion_counts"] = exclusion_counts
        source_universe_metadata = source_universe_manifest_metadata(
            risk_set_census
        )
        outputs.update(
            {
                "affiliated_risk_set_census": write_table(
                    risk_set_census,
                    args.output_dir / "affiliated_risk_set_census.parquet",
                ),
                "affiliated_risk_set_snapshots": write_table(
                    risk_set_snapshots,
                    args.output_dir / "affiliated_risk_set_snapshots.parquet",
                ),
                "affiliated_arrival_labels": write_table(
                    risk_set_labels,
                    args.output_dir / "affiliated_arrival_labels.parquet",
                ),
            }
        )
        risk_set_manifest = {
            "contract_version": RISK_SET_CONTRACT_VERSION,
            "snapshot_policy": RISK_SET_POLICY,
            "strict_point_in_time_features": risk_set_quality[
                "strict_point_in_time_features"
            ],
            "effective_time_safe": risk_set_quality["effective_time_safe"],
            "knowledge_time_verified": risk_set_quality[
                "knowledge_time_verified"
            ],
            "board_enrichment_policy": risk_set_quality[
                "board_enrichment_policy"
            ],
            **source_universe_metadata,
            "model_analysis_scope": "mlb_naive_outcome_linked_supported_features",
            "model_exclusion_counts": exclusion_counts,
            "release_eligible": False,
            "release_blockers": affiliated_release_blockers(
                using_bref_adapter=bool(all(bref_paths)),
                unresolved_identity_rows=int(
                    risk_set_quality["unresolved_identity_rows"]
                ),
            ),
            "model_eligible_rows": int(len(risk_set_snapshots)),
            "quality": risk_set_quality,
            "label_quality": risk_set_label_quality,
            "inputs": risk_set_input_evidence,
        }
    coverage = (
        labels.merge(snapshots[["snapshot_id", "edition", "role"]], on="snapshot_id")
        .groupby(["edition", "role"], dropna=False)
        .size()
        .rename("snapshots")
        .reset_index()
        .to_dict("records")
    )
    dataset_content = {
        "schema_version": 1,
        "data_cutoff": DATA_CUTOFF,
        "snapshot_policy": SNAPSHOT_POLICY,
        "source_lock_sha256": source_hash(source_lock),
        "outputs": {
            name: {"rows": output["rows"], "sha256": output["sha256"]}
            for name, output in outputs.items()
        },
    }
    dataset_content_sha256 = json_sha256(dataset_content)
    archive_dataset_outputs(outputs, args.output_dir, dataset_content_sha256)
    manifest = {
        "schema_version": 1,
        "built_at": datetime.now().astimezone().isoformat(),
        "dataset_content_sha256": dataset_content_sha256,
        "data_cutoff": DATA_CUTOFF,
        "snapshot_policy": SNAPSHOT_POLICY,
        "strict_point_in_time": False,
        "release_eligible": False,
        "release_blockers": [
            "FanGraphs editions have a year label but no evidenced exact publication timestamp.",
            "The cohort contains ranked/scouted prospects, not a complete affiliated-player roster census.",
            "The baseline is therefore conditional on appearing on a FanGraphs board.",
            *(
                [
                    "Canonical MiLB census inputs are content-hashed but are not yet "
                    "verified by the acquisition source lock."
                ]
                if risk_set_manifest is not None
                else []
            ),
        ],
        "source_lock": {
            "path": str(source_lock.relative_to(ROOT)),
            "sha256": source_hash(source_lock),
        },
        "acquisition_manifest": acquisition_evidence,
        "producer": producer_metadata(
            ROOT,
            [
                Path(__file__),
                ROOT / "modeling/contracts.py",
                ROOT / "modeling/provenance.py",
                ROOT / "modeling/risk_set.py",
                ROOT / "modeling/requirements.lock",
            ],
            {
                "raw_root": portable_path(args.raw_root),
                "output_dir": portable_path(args.output_dir),
                "acquisition_manifest": acquisition_evidence["path"],
                "milb_census_metadata": portable_path(args.milb_census_metadata)
                if args.milb_census_metadata
                else None,
                "milb_roster_census": portable_path(args.milb_roster_census)
                if args.milb_roster_census
                else None,
                "milb_player_seasons": portable_path(args.milb_player_seasons)
                if args.milb_player_seasons
                else None,
                "bref_player_team_seasons": portable_path(
                    args.bref_player_team_seasons
                )
                if args.bref_player_team_seasons
                else None,
                "bref_quality": portable_path(args.bref_quality)
                if args.bref_quality
                else None,
                "bref_teams": portable_path(args.bref_teams)
                if args.bref_teams
                else None,
                "bref_team_organizations": portable_path(
                    args.bref_team_organizations
                )
                if args.bref_team_organizations
                else None,
            },
        ),
        "identity_quality": identity_quality,
        "label_quality": label_quality,
        "career_identity_quality": {
            "matched_outcomes": int(career_outcomes["player_id"].notna().sum()),
            "unmatched_outcomes": int(career_outcomes["player_id"].isna().sum()),
            "matched_landmarks": int(career_landmarks["player_id"].notna().sum()),
            "unmatched_landmarks": int(career_landmarks["player_id"].isna().sum()),
        },
        "coverage": coverage,
        "affiliated_risk_set": risk_set_manifest,
        "outputs": outputs,
    }
    manifest_sha256 = json_sha256(manifest)
    manifest["manifest_sha256"] = manifest_sha256
    manifest_body = json.dumps(manifest, indent=2, default=str) + "\n"
    manifest_path = args.output_dir / "dataset_manifest.json"
    archive_path = args.output_dir / "manifests" / f"{manifest_sha256}.json"
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(manifest_body)
    archive_path.write_text(manifest_body)
    print(
        json.dumps(
            {
                "manifest": str(manifest_path),
                "manifest_sha256": manifest_sha256,
                "outputs": outputs,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
