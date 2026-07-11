from modeling.contracts import (
    CATEGORICAL_FEATURES,
    FORBIDDEN_FEATURE_TOKENS,
    NUMERIC_FEATURES,
    assert_feature_contract,
)


def test_feature_contract_has_no_future_or_outcome_fields() -> None:
    features = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    assert_feature_contract(features)
    assert not [
        feature
        for feature in features
        if any(token in feature.lower() for token in FORBIDDEN_FEATURE_TOKENS)
    ]


def test_feature_contract_rejects_missing_columns() -> None:
    try:
        assert_feature_contract(NUMERIC_FEATURES)
    except ValueError as error:
        assert "Missing declared feature columns" in str(error)
    else:
        raise AssertionError("An incomplete feature frame must be rejected")


def test_feature_contract_rejects_extra_outcome_columns() -> None:
    try:
        assert_feature_contract(NUMERIC_FEATURES + CATEGORICAL_FEATURES + ["debut_date"])
    except ValueError as error:
        assert "Forbidden outcome/future fields" in str(error)
    else:
        raise AssertionError("Outcome columns must be rejected even when the allowlist is complete")
