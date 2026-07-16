# Football Market Source Attestation

## Attestation

On 2026-07-16, after the Football Oracle product explicitly identified its
intended automated retrieval, caching, public display, and derived-ranking use,
the project owner confirmed that Baseball Oracle has permission from both
KeepTradeCut and Dynasty Daddy to proceed.

The owner-attested scope covers:

- automated retrieval of KTC Dynasty and KTC Devy rankings;
- automated retrieval of Dynasty Daddy's first-party dynasty rankings;
- retention of source responses and point-in-time research snapshots;
- attributed normalized rank, value, tier, and movement display;
- position- and format-matched derived comparison signals; and
- commercial display inside Baseball Oracle and Football Oracle.

## Boundaries

This attestation does not infer permission to resell or redistribute raw source
responses as a standalone dataset. Raw payloads remain private; public product
responses expose only the normalized fields required for attributed comparison.

Model training is not included in this attestation. External market readings
remain comparison signals and are not silently blended into independent Oracle
model scores.

Dynasty Daddy displays several additional markets. This attestation activates
only Dynasty Daddy's first-party dynasty market. KTC is separately covered by
the KTC permission above. ADP Daddy and every other upstream market remain
excluded until their scope is separately confirmed.

## Operational Policy

Provider attribution and canonical source links stay attached to every public
snapshot. Retrieval is bounded and cached. Adapters fail closed when the
provider, market identity, format, schema, or player universe cannot be
validated exactly.

The project owner is responsible for retaining the underlying permission
correspondence and making it available if the provider, project maintainer, or
legal reviewer requests it.
