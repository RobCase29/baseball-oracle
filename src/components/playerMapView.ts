import type { PlayerRecord } from '../domain/forecast'
import { buildPlayerMap, type PlayerMapProfile } from '../domain/playerMap'

export function playerMapFor(player: PlayerRecord): PlayerMapProfile {
  return player.playerMap ?? buildPlayerMap(player)
}
