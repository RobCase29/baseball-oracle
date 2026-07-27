# Spotrac Source Attestation

## Recorded Statement

On 2026-07-26, in the Codex task that requested expanded Team Runway contract
coverage, the user stated: “We’re authorized to scrape spotrac thanks”.

This file records that exact user-provided statement as the project's
permission basis for the Spotrac adapter. It is a project attestation, not
independent verification of the underlying authorization, its duration, or the
user's authority to grant it.

## Attested Project Scope

The project treats the statement as authorizing:

- rate-limited automated retrieval of public Spotrac team contract-list and
  player pages for MLB, NFL, NBA, and NHL;
- caching source responses for reproducible ingestion and audit;
- normalization of public player contract, team, option, free-agency, and
  transaction facts needed by Team Runway; and
- attributed display of the minimum normalized facts and derived neutral
  mobility context inside Baseball Oracle.

## Boundaries

This attestation does not establish or imply:

- ownership of Spotrac data or intellectual property;
- a partnership, endorsement, or independently verified direct license from
  Spotrac;
- permission to bypass authentication, paywalls, CAPTCHAs, robots controls,
  rate limits, or any other technical or access control;
- permission to retrieve private, account-only, or otherwise non-public
  material;
- permission to resell, sublicense, or redistribute raw Spotrac pages or a raw
  bulk replica of the source data;
- permission for leagues, products, data categories, or uses outside the
  Team Runway scope above; or
- an indefinite right beyond the authorization actually granted.

## Operational Conditions

The Spotrac retrieval adapter must be bounded, rate-limited, and cache-first.
Its default mode is a non-mutating dry run; a network retrieval or cache update
requires an explicit execute action. The adapter must fail closed on access
blocks, unsupported pages, identity ambiguity, schema drift, or invalid
chronology and must never attempt to work around those conditions.

Every normalized record must retain the canonical Spotrac player identifier,
source URL, access time, data-through date, and reviewed bridge to the app's
subject identity. The artifact-wide source chain referenced by those rows must
retain parser and normalizer versions, permission and robots hashes, the
acquisition-manifest hash, and canonical team-page content hashes. Raw cached
responses remain private. Public artifacts expose only the normalized facts
and compact audit receipts necessary for Team Runway and retain the neutral
`contextOnly: true` and `directionalClaim: false` semantics.

The project owner is responsible for retaining the underlying authorization
and making it available if Spotrac, a project maintainer, or a legal reviewer
requests it. If the source, access method, public use, or product scope changes
materially, the project owner should confirm that the changed use remains
authorized before proceeding.
