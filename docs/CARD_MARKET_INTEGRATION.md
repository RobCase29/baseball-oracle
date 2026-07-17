# Card Market Integration

Baseball Oracle uses the private player-model feed only as independent card-market
context. It does not blend market prices, community rankings, or provider ranking
fields into Oracle player scores.

## Public Oracle Contract

`GET /api/v1/card-market?player=<exact player name>&release=<optional release>`

The endpoint:

- accepts one exact player name and an optional release;
- returns the source-neutral `card-market.v1` contract;
- exposes modeled raw base-auto price, range, evidence, freshness, and an optional
  variation ladder;
- strips upstream rankings, provenance, model names, and arbitrary warning text;
- keeps the private API credential server-side;
- revalidates with the upstream ETag after five minutes;
- serves a last-known-good result for up to one hour during a short outage.

The browser requests this route only after a player dossier opens. Board rankings
do not depend on the feed.

## Environment

Production requires the sensitive server variable:

```text
BACKSTOP_API_KEY
```

`BACKSTOP_API_BASE` is optional and defaults to the production player-model API.
Neither variable may use a `VITE_` prefix.

## Product Boundary

The UI labels the values as card-market evidence and explicitly avoids expected
return language. A true card expected-value model would require validated future
sale outcomes, transaction costs, holding periods, and liquidity assumptions.
Until that model exists, Oracle supplies the player thesis while this integration
supplies price and market-depth context.

## Verification

```bash
npm run typecheck
npx vitest run api/_card-market.test.ts src/components/oracle-board.test.tsx
npm run build
```
