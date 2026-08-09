import { describe, expect, it } from 'vitest'
import { hobbyMasterCatalog } from '../../api/_hobby-master-ranking.js'
import { hobbyPlayerRankingCatalog } from '../../api/_hobby-player-rankings.js'
import {
  buildBinderGraduationAssessment,
  isBinderGraduationResponse,
  withBinderGraduationRank,
  type BinderGraduationItem,
} from './binderGraduationIndex.js'

function player(name: string) {
  const result = hobbyPlayerRankingCatalog.items.find(
    (item) => item.name === name,
  )
  if (!result) throw new Error(`Missing player fixture ${name}`)
  return structuredClone(result)
}

function masterFor(sourceKey: string) {
  const result = hobbyMasterCatalog.items.find(
    (item) => item.subject.id === sourceKey,
  )
  if (!result) throw new Error(`Missing master fixture ${sourceKey}`)
  return structuredClone(result)
}

function assessmentFor(name: string) {
  const candidate = player(name)
  return buildBinderGraduationAssessment({
    player: candidate,
    master: masterFor(candidate.identity.gemRateSourceKey),
    globalTopOneTtmFloorUsd: 8_177_000,
  })
}

describe('Binder Graduation Index', () => {
  it('rejects malformed response items without throwing', () => {
    expect(isBinderGraduationResponse({
      schemaVersion: 'backstop-binder-index.v1',
      contractVersion: 'backstop-binder-index-contract/v1',
      modelVersion: 'binder-graduation-readiness/master-build-v2.0.0',
      items: [{}],
    })).toBe(false)
  })

  it('marks current Master Builds as graduated without publishing a probability', () => {
    const result = assessmentFor('Drake Maye')

    expect(result).toMatchObject({
      status: 'graduated',
      index: 100,
      globalRank: null,
      band: 'graduated',
      probability: null,
      probabilityStatus: 'withheld_no_longitudinal_build_transitions',
      projectedRoute: 'graduated',
      primaryBlocker: 'already_on_build_board',
    })
  })

  it('surfaces clean near-gate candidates without calling the index a percent', () => {
    const caleb = assessmentFor('Caleb Williams')

    expect(caleb.status).toBe('ranked')
    expect(caleb.band).toBe('on_deck')
    expect(caleb.index).toBeGreaterThanOrEqual(85)
    expect(caleb.index).toBeLessThan(100)
    expect(caleb.projectedRoute).toBe('durable_scale')
    expect(caleb.distance.ttmSalesUsd).toBeGreaterThan(0)
    expect(caleb.probability).toBeNull()
  })

  it('keeps dynasty enthusiasm from carrying a tiny absolute market', () => {
    const candidate = player('Caleb Williams')
    const master = masterFor(candidate.identity.gemRateSourceKey)
    const baseline = buildBinderGraduationAssessment({
      player: candidate,
      master,
      globalTopOneTtmFloorUsd: 8_177_000,
    })
    master.assessment.marketSignal.latestTwelveMonthSalesUsd = 500_000
    master.assessment.marketSignal.annualizedCurrentSixMonthSalesUsd = 500_000
    master.assessment.marketSignal.score = 35
    master.assessment.marketSignal.globalObservedPercentile = 90
    const thinMarket = buildBinderGraduationAssessment({
      player: candidate,
      master,
      globalTopOneTtmFloorUsd: 8_177_000,
    })

    expect(thinMarket.index).not.toBeNull()
    expect(baseline.index).not.toBeNull()
    expect(thinMarket.index!).toBeLessThan(baseline.index! - 30)
    expect(thinMarket.band).toBe('long_range')
  })

  it('uses age as a screen rather than a hidden positive score input', () => {
    const candidate = player('Anthony Edwards')
    const master = masterFor(candidate.identity.gemRateSourceKey)
    const younger = buildBinderGraduationAssessment({
      player: { ...candidate, age: 19 },
      master,
      globalTopOneTtmFloorUsd: 8_177_000,
    })
    const older = buildBinderGraduationAssessment({
      player: { ...candidate, age: 29 },
      master,
      globalTopOneTtmFloorUsd: 8_177_000,
    })

    expect(younger.index).toBe(older.index)
  })

  it('assigns one rank across sports and never ranks current graduates', () => {
    const names = ['Caleb Williams', 'Kon Knueppel', 'Drake Maye']
    const items = names.map((name): BinderGraduationItem => {
      const candidate = player(name)
      const master = masterFor(candidate.identity.gemRateSourceKey)
      return {
        recordVersion: 'backstop-binder-graduation-item/v1',
        player: {
          id: candidate.id,
          name: candidate.name,
          normalizedName: candidate.normalizedName,
          sport: candidate.sport,
          age: candidate.age,
          positions: [...candidate.positions],
          primaryPosition: candidate.primaryPosition,
          team: candidate.team,
        },
        graduation: buildBinderGraduationAssessment({
          player: candidate,
          master,
          globalTopOneTtmFloorUsd: 8_177_000,
        }),
        playerSignal: {
          score: candidate.score,
          outlook: candidate.components.outlook,
          marketDurability: candidate.components.marketDurability,
          evidenceYears: candidate.evidence.evidenceYears,
          evidenceStage: candidate.evidence.evidenceStage,
          inputIntegrity: candidate.confidence.score,
        },
        market: {
          masterRank: master.masterRank,
          masterScore: master.assessment.marketSignal.score,
          boardPosture: master.assessment.posture,
          buildRoute: master.assessment.buildQualification.route,
          ttmSalesUsd:
            master.assessment.marketSignal.latestTwelveMonthSalesUsd,
          currentRunRateUsd:
            master.assessment.marketSignal.annualizedCurrentSixMonthSalesUsd,
          globalObservedPercentile:
            master.assessment.marketSignal.globalObservedPercentile,
          durability: master.assessment.marketSignal.durabilityScore,
          persistence:
            master.assessment.marketSignal.components.persistence,
          shockResistance:
            master.assessment.marketSignal.components.shockResistance,
          downsideProtection:
            master.assessment.marketSignal.downsideProtectionScore,
        },
        identity: candidate.identity,
        sources: candidate.sources,
      }
    })
    const ranked = withBinderGraduationRank(items)
    const byName = new Map(
      ranked.map((item) => [item.player.name, item.graduation.globalRank]),
    )

    expect(byName.get('Kon Knueppel')).toBe(1)
    expect(byName.get('Caleb Williams')).toBe(2)
    expect(byName.get('Drake Maye')).toBeNull()
  })
})
