# Immutable Raw Archive

## Decision

Use a dedicated **private Vercel Blob store** for authorized raw payloads and
Neon as the searchable lineage catalog. The private `baseball-oracle-raw` store
was provisioned in `iad1` on July 11, 2026 and is connected to the Vercel
project's production, preview, and development environments.

The archive is logically append-only:

- Exact response bytes are hashed before upload.
- The pathname is content-addressed as
  `raw/v1/{source}/{dataset}/sha256/{prefix}/{sha256}`.
- The storage adapter may create or resolve that exact object, but cannot
  expose overwrite or delete operations.
- Neon `raw.archive_object`, `raw.archive_manifest`, and
  `raw.archive_manifest_member` catalog private object metadata and the exact
  evidence graph separately from inline `raw.blob` landing rows.
- A database row is committed only after storage confirms the object. An
  orphaned object is safe and can be reconciled; a dangling database pointer is
  not.

The create-only contract is implemented in
`scripts/archive/immutable-raw-archive.ts`. It recomputes byte length and SHA-256,
rejects unsafe path segments, and fails closed on an inconsistent provider
receipt. `scripts/archive/vercel-private-blob-store.ts` supplies the private Blob
adapter. Its replay path downloads and hashes a same-path object before accepting
it as the same content.

## Current Archive

The first complete archive contains all 44 resources in the pinned acquisition
manifest plus the source lock, acquisition manifest, and permission evidence.
The checkpoint records 47 evidence receipts totaling 162,011,234 bytes. The
content-addressed archive manifest adds one object, for a verified remote total
of 48 private objects and 162,047,452 bytes.

The archive manifest SHA-256 is:

```text
c5df36a9e3cc552c06af1c85468e93910efa695ec2bc9c8c39759eb2faf50743
```

Completed Baseball-Reference history is archived separately. The current
historical archive contains:

| Season | Archived inputs | Source bytes | Season manifest |
| ---: | ---: | ---: | --- |
| 2010 | 229 | 88,230,722 | `f535646fa3029f67b60e1d0f917e733407618719bd7382817db5214346a34363` |
| 2011 | 228 | 87,784,078 | `48e38cebb3cd9cad326dd0f5d0000087364941729267a82f27d6d58e2cfe7cc1` |
| 2012 | 227 | 88,092,610 | `942415f6bb8ac2d828e4ece2e6c50822cefacf9aab35ee98990e6b779b704502` |
| 2013 | 230 | 88,997,338 | `598c2240dfdfce8b640821bdac85f1790e09d491c32409e58fea8a8b8e78b18f` |
| 2014 | 231 | 90,335,270 | `89a75272d7d19e36588cce8ea45e7e5218d6d7410d17e1254c7950dfd9284ad6` |
| 2015 | 234 | 92,217,422 | `8a7165bef72da3dc9ced554ae6de4cb7e323ff8d3faeedd970c05e921aab058b` |
| 2016 | 234 | 93,448,455 | `5a02ae9c8345cda8f1941ce8e0afcc21ee158a80530e136ffa31129d6f9dd050` |
| 2017 | 233 | 93,988,604 | `ccd39a256d19e6fc0597cb220c497f127fdaf0ddda0600bef6d4abab8aa5ca54` |
| 2018 | 241 | 97,840,369 | `931bad5218f62b80d92d4c4a376eced68c5e6ae6256413377818027b62c7cc19` |
| 2019 | 245 | 100,429,356 | `f7f7bd909c0e7dc5a26926afb7092ecd9ab2a114bc4a4a2a34c380138130a3be` |
| 2020 | 0 | 0 | `107885d401f5f5a742dd245620457a0f366e96b629fedc3c9b75bb4877778049` |

The committed season locks point only to complete supported parser runs. Earlier
season manifests remain preserved as superseded evidence. The current locks cover
2,332 archived inputs and 921,364,224 source bytes; the private remote inventory also
contains their content-addressed manifests and preserved superseded evidence.

Replaying the command is checkpointed and does not upload or create a second
manifest for an already-complete acquisition:

```bash
npm run archive:locked-corpus
```

Completed Baseball-Reference Register seasons use a separate promotion command
and checkpoint namespace:

```bash
npm run archive:sports-reference -- --season=2017
```

That command accepts only the latest run whose season coverage fully
reconciles. It re-hashes each exact HTML cache entry and its permission evidence
before archiving payloads and a deterministic season manifest beneath
`raw/v1/sports-reference/baseball-register/`. It never advances a partial
crawl, and it must not be run until that season's backfill reports complete.
Each completed promotion also writes a non-secret, committed season lock under
`data/archive-locks/sports-reference-baseball-register/`.

The ignored local checkpoint is `data/manifests/archive/latest.json`. It contains
private object locations and must never be committed, logged, or returned from a
public API. Remote verification uses the private credential to list the
`raw/v1/` prefix and compares object count and byte length to the checkpoint.

The committed `data/archive-catalog-lock.json` is the non-secret deployment
anchor. It contains the checkpoint and manifest digests, content-addressed
pathnames, counts, timestamps, and media metadata, but no object URL, ETag, or
credential. Completing `archive:locked-corpus` regenerates this lock from the
exact checkpoint bytes.

Archive objects and logical evidence members are separate concepts. One physical
content-addressed object may satisfy multiple logical resources with identical
bytes. Checkpoints retain one verified receipt per object plus an explicit logical
membership map; manifest counts and bytes use `logical-membership-bytes/v1`
semantics. Legacy one-member-per-object checkpoints remain byte-for-byte valid.

On Vercel, the build runs database migrations and then performs idempotent
catalog registration. When the ignored local checkpoint is absent, the
registrar reads the private archived manifest by its locked pathname, rebuilds
the checkpoint with runtime Blob metadata, and requires the rebuilt checkpoint
digest to equal the committed lock. It similarly reads the acquisition manifest
from private Blob when the ignored local copy is absent. Any digest, byte count,
media type, pathname, or metadata mismatch stops the build before registration.

Validate the complete evidence chain without touching Neon:

```bash
npm run archive:register-catalog -- --validate-only
```

Register locally when both Neon and Blob credentials are present:

```bash
npm run archive:register-catalog
```

The connected environments currently expose `BLOB_READ_WRITE_TOKEN`. Never
prefix that variable with `VITE_`, print its value, or embed it in browser code.
Refresh local values from the linked Vercel project when necessary:

```bash
npx vercel env pull .env.local --environment=preview --yes
```

## Provider Adapter

The `@vercel/blob` adapter for `ImmutableObjectStore` follows these rules:

1. Use `access: 'private'`, `addRandomSuffix: false`, and never set
   `allowOverwrite: true`.
2. Use multipart upload above 100 MB.
3. Treat a same-path conflict as a possible idempotent replay, stream and hash
   the existing object, and require pathname, byte length, and digest to match.
4. Return the private HTTPS object URI to `persistRawLanding`; never expose it
   from a public API.
5. Keep delete, rename, and copy methods out of the ingestion process.

Bulk historical acquisition should upload directly from the research runner,
then register receipts in Neon. It should not relay hundreds of megabytes
through a Vercel Function. Scheduled incremental ingestion may use a protected
server function when payloads remain small enough for the runtime limit.

## Verification And Recovery

- Verify every upload before committing its Neon lineage row.
- Run a periodic catalog reconciliation: every `object_uri` resolves, pathname
  digest equals the catalog digest, and length matches.
- Re-hash a rotating sample of downloaded objects; perform a full verification
  before a model release.
- Preserve run manifests as content-addressed archive objects and reference
  their hashes from model dataset manifests.
- Do not put restricted raw bytes in Git, build artifacts, logs, or public Blob
  stores.

## Important Limitation

Vercel Blob provides durable private object storage and prevents overwrites by
default, but it is not a compliance WORM vault: credentialed users can still
delete objects and Vercel does not provide a native backup system. Application
immutability therefore depends on content-addressed keys, no delete capability
in code, restricted Vercel roles, Neon audit lineage, and independent
verification. If legal retention or protection against an account-owner delete
becomes a requirement, mirror the archive to S3 Object Lock in compliance mode
under a separate account.
