/**
 * Official scoring formula, mirrored by server validation:
 * - 1 point per 8 world pixels reached (based on furthest progress, never time spent).
 * - 75 points per unique checkpoint reached.
 * - 500 points for reaching the finish.
 * - Up to 600 time bonus points at 10 per full second remaining.
 * Deaths never subtract earned progress, but death loops cannot farm points because furthestX is monotonic.
 */
export function calculateScore({ furthestX = 0, checkpoints = [], completed = false, timeRemaining = 0 } = {}) {
  const distancePoints = Math.max(0, Math.floor(furthestX / 8));
  const checkpointPoints = new Set(checkpoints).size * 75;
  const finishPoints = completed ? 500 : 0;
  const timeBonus = completed ? Math.max(0, Math.min(60, Math.floor(timeRemaining))) * 10 : 0;
  return Math.max(0, distancePoints + checkpointPoints + finishPoints + timeBonus);
}
export const SCORING_RULES = Object.freeze({ pointsPerWorldPixels: 8, pointsPerCheckpoint: 75, completionBonus: 500, timeBonusPerSecond: 10, maximumTimeBonus: 600 });
