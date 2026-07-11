# Trouble With The Curve Audit

Audited July 11, 2026 as methodological prior art only. No data from this repository
is included in Baseball Oracle's training corpus.

## Pinned Artifact

- Repository commit: `99297bb145049082818125adf19423b2ef254734`.
- Referenced `webapp/jdnlp` commit: `7399d029477cfaa8dd9c52c4d8d2c84810f2cef2`.
- CSV path: `data/twtc.csv`.
- Bytes: `19,415,394`.
- SHA-256: `e2a4cd65941c5a9411d6648836eb26b9ab0d547e9c41d11f2b1d5a88125a9c8b`.
- Profiles: 9,175.
- Distinct displayed names: 3,549.
- Editions: 2013-2019.
- Source rows: 7,342 MLB.com and 1,833 FanGraphs.

## Audit Method

The audit pinned the commit and content hash, parsed the CSV with all identifiers as
strings, and measured:

- Label and source counts.
- Repeated names and repeated name/year/source profiles.
- Player-name overlap across the repository's committed random train/test split.
- Debut fields that contradict the committed label.
- Placeholder and age-inconsistent birth dates.
- FanGraphs and MLBAM IDs assigned to multiple displayed names.
- The all-negative accuracy implied by the committed test class balance.

The external `webapp/jdnlp` commit referenced by the repository was inspected to
confirm random row splitting and the test records. No model weights or source prose
were copied into Baseball Oracle.

The calculations are executable against a separately obtained copy of the pinned
CSV. The script verifies the file hash before reading it and emits aggregate counts
only:

```bash
npm run audit:twtc -- --input=/path/to/twtc.csv
```

## Result

Four hundred seventy displayed player names appear in both train and test, covering
69.6% of test players. An all-negative classifier is 73.52% accurate on that test
set, equal to the reported BCN accuracy. At least 1,155 zero-labeled rows already
contain an MLB debut in the committed data, with additional outcomes now stale as
young careers matured. The CSV contains scouting reports and 12 explicit scouting
grade columns, but no minor-league performance statistics.

The repository has no project-wide license. Its outcome labels, random splits,
identity joins, and raw prose are therefore not used. Reusable hypotheses are
limited to independently testing permitted 20-80 grades, longitudinal scouting
changes, and entity-masked report language as forward-fold ablations.
