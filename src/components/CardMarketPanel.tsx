import { BadgeDollarSign, CircleDashed, Info, LoaderCircle } from 'lucide-react'
import type { CardMarketModel, CardMarketResponse } from '../domain/cardMarket'

interface CardMarketPanelProps {
  response: CardMarketResponse | null
  loading: boolean
  error: string | null
}

const cardCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

function formatCardPrice(value: number | null): string {
  return value === null ? 'Not priced' : cardCurrency.format(value)
}

function cardPriceRange(model: CardMarketModel): string {
  const { low, high } = model.valuation
  if (low === null || high === null) return 'Range building'
  return `${formatCardPrice(low)}–${formatCardPrice(high)}`
}

function marketEvidenceLabel(model: CardMarketModel): string {
  const labels = {
    strong: 'Strong evidence',
    moderate: 'Moderate evidence',
    thin: 'Thin evidence',
    unpriced: 'Not enough evidence',
  } as const
  return labels[model.valuation.evidenceQuality]
}

function marketFreshnessLabel(model: CardMarketModel): string {
  const age = model.freshness.latestSaleAgeDays
  if (age === null) return 'No dated sale'
  if (age === 0) return 'Latest sale today'
  return `Latest sale ${age} day${age === 1 ? '' : 's'} ago`
}

function MarketVariationLadder({ model }: { model: CardMarketModel }) {
  const variations = model.variations
    .filter((variation) => variation.amount !== null && variation.key !== 'base')
    .toSorted((left, right) => (
      Number(right.actionable) - Number(left.actionable) ||
      (right.amount ?? 0) - (left.amount ?? 0)
    ))
    .slice(0, 8)

  if (variations.length === 0) return null

  return (
    <details className="market-variations">
      <summary>Variation values ({variations.length})</summary>
      <div className="market-variation-list">
        {variations.map((variation) => (
          <div key={variation.key}>
            <span>{variation.label}</span>
            <strong>{formatCardPrice(variation.amount)}</strong>
            <small>
              {variation.low !== null && variation.high !== null
                ? `${formatCardPrice(variation.low)}–${formatCardPrice(variation.high)}`
                : variation.actionable ? 'Modeled price' : 'Early estimate'}
            </small>
          </div>
        ))}
      </div>
    </details>
  )
}

export function CardMarketPanel({
  response,
  loading,
  error,
}: CardMarketPanelProps) {
  const pricedModels = (response?.items ?? []).filter((model) => model.valuation.amount !== null)
  const featured = pricedModels[0] ?? response?.items[0] ?? null
  const otherReleases = pricedModels.filter((model) => model.modelId !== featured?.modelId).slice(0, 3)
  const hiddenReleaseCount = Math.max(0, pricedModels.length - otherReleases.length - (featured ? 1 : 0))

  return (
    <section className="dossier-section card-market-panel" aria-labelledby="card-market-title">
      <div className="section-heading-row card-market-heading">
        <div>
          <span className="eyebrow">CARD MARKET</span>
          <h2 id="card-market-title">Raw autograph market</h2>
        </div>
        <span className="market-independent-badge">Independent evidence</span>
      </div>

      {loading ? (
        <div className="market-status" role="status">
          <LoaderCircle className="spin" size={18} aria-hidden="true" />
          <div>
            <strong>Checking card-market evidence</strong>
            <span>Matching releases, modeled prices, and recent sales.</span>
          </div>
        </div>
      ) : error ? (
        <div className="market-status market-status--muted" role="status">
          <CircleDashed size={18} aria-hidden="true" />
          <div>
            <strong>Pricing connection unavailable</strong>
            <span>The player outlook above is unaffected. Card-market evidence will return when the connection refreshes.</span>
          </div>
        </div>
      ) : !featured ? (
        <div className="market-status market-status--muted">
          <CircleDashed size={18} aria-hidden="true" />
          <div>
            <strong>No matched raw autograph model</strong>
            <span>No canonical release-level valuation is available for this player yet.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="market-release-bar">
            <div>
              <span>FEATURED RELEASE</span>
              <strong>{featured.card.release}</strong>
              <small>{featured.card.productFamily} · Raw base autograph</small>
            </div>
            <span className={`market-evidence-pill market-evidence-pill--${featured.valuation.evidenceQuality}`}>
              {marketEvidenceLabel(featured)}
            </span>
          </div>

          <div className="market-metrics">
            <div className="market-price-primary">
              <span>MODELED PRICE</span>
              <strong>{formatCardPrice(featured.valuation.amount)}</strong>
              <small>Raw base autograph</small>
            </div>
            <div>
              <span>MODELED RANGE</span>
              <strong>{cardPriceRange(featured)}</strong>
              <small>Price uncertainty, not a return forecast</small>
            </div>
            <div>
              <span>PRICE CONFIDENCE</span>
              <strong>{featured.valuation.confidenceScore}/100</strong>
              <small>{featured.valuation.actionable ? 'Usable market estimate' : 'Directional estimate'}</small>
            </div>
            <div>
              <span>SALES DEPTH</span>
              <strong>{featured.evidence.sales.toLocaleString()}</strong>
              <small>{featured.evidence.sales30.toLocaleString()} in 30 days · {featured.evidence.sales90.toLocaleString()} in 90</small>
            </div>
          </div>

          <div className="market-freshness">
            <BadgeDollarSign size={16} aria-hidden="true" />
            <div>
              <strong>{marketFreshnessLabel(featured)}</strong>
              <span>
                {featured.evidence.auctionSales.toLocaleString()} auction · {featured.evidence.binSales.toLocaleString()} fixed-price
                {featured.freshness.stale ? ' · Refresh needed' : ' · Current model'}
              </span>
            </div>
          </div>

          {otherReleases.length > 0 ? (
            <div className="market-release-list" aria-label="Other priced releases">
              <div className="market-release-list-header">
                <span>OTHER RELEASES</span>
                <span>PRICE</span>
                <span>RANGE</span>
                <span>EVIDENCE</span>
              </div>
              {otherReleases.map((model) => (
                <div className="market-release-row" key={model.modelId}>
                  <strong>{model.card.release}</strong>
                  <span>{formatCardPrice(model.valuation.amount)}</span>
                  <span>{cardPriceRange(model)}</span>
                  <span>{marketEvidenceLabel(model)}</span>
                </div>
              ))}
              {hiddenReleaseCount > 0 ? (
                <small className="market-release-overflow">+{hiddenReleaseCount} more priced release{hiddenReleaseCount === 1 ? '' : 's'}</small>
              ) : null}
            </div>
          ) : null}

          <MarketVariationLadder model={featured} />

          <div className="market-note">
            <Info size={14} aria-hidden="true" />
            <span>Card-market pricing is independent context and does not change Oracle rankings. No card-return forecast is implied.</span>
          </div>
        </>
      )}
    </section>
  )
}
