// Pure enhancement Markov model shared by market valuation and planner time estimates.
// Credit: Markov enhancement expectation model aligned with Toolasha (Celasha, https://greasyfork.org/scripts/562662, CC-BY-NC-SA-4.0) & Enhancelator/MWITools.
//
// Success rate per attempt matches the game client: `(1 + Σ enhancing_success.ratioBoost) × table[level]`,
// where the level term is `+0.0005 × (level − itemLevel)` (or `−0.5 × (1 − level / itemLevel)` when
// under-levelled) and `toolBonus` is the remaining `enhancing_success` ratio in percent.

export const BASE_SUCCESS_RATES = [
  50, 45, 45, 40, 40, 40, 35, 35, 35, 35, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
];

/** Pure-TS Gaussian elimination inversion for small transient matrix (I - Q)^-1. */
export function invertMatrix(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = matrix[i][j];
    row[n + i] = 1;
    return row;
  });

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let maxAbs = Math.abs(aug[col][col]);
    for (let r = col + 1; r < n; r++) {
      const abs = Math.abs(aug[r][col]);
      if (abs > maxAbs) {
        maxAbs = abs;
        pivotRow = r;
      }
    }
    if (maxAbs < 1e-12) return null;
    if (pivotRow !== col) {
      const tmp = aug[col];
      aug[col] = aug[pivotRow];
      aug[pivotRow] = tmp;
    }

    const pivot = aug[col][col];
    for (let j = col; j < 2 * n; j++) {
      aug[col][j] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = col; j < 2 * n; j++) {
        aug[r][j] -= factor * aug[col][j];
      }
    }
  }

  return aug.map((row) => row.slice(n));
}

export interface MarkovResult {
  readonly attempts: number;
  readonly protectionCount: number;
}

const MARKOV_CACHE_LIMIT = 4096;
const markovCache = new Map<string, MarkovResult | null>();

/** Pure Markov expected attempts/protections, memoized across market price invalidations. */
export function solveEnhancementMarkov(
  enhancingLevel: number,
  toolBonus: number,
  itemLevel: number,
  targetLevel: number,
  protectFrom: number,
  blessedTea: boolean,
  guzzlingBonus: number,
  /** Current enhancement level the attempts start from (default 0 = from scratch). */
  startLevel = 0
): MarkovResult | null {
  const start = Math.max(0, Math.floor(startLevel));
  if (!(targetLevel > start)) return null;
  const cacheKey = `${enhancingLevel}|${toolBonus}|${itemLevel}|${targetLevel}|${protectFrom}|${blessedTea ? 1 : 0}|${guzzlingBonus}|${start}`;
  if (markovCache.has(cacheKey)) {
    return markovCache.get(cacheKey)!;
  }

  const totalBonus =
    enhancingLevel >= itemLevel
      ? 1 + (toolBonus + 0.05 * (enhancingLevel - itemLevel)) / 100
      : 1 - 0.5 * (1 - enhancingLevel / itemLevel) + toolBonus / 100;

  const Q: number[][] = Array.from({ length: targetLevel }, () => new Array<number>(targetLevel).fill(0));
  const iMinusQ: number[][] = Array.from({ length: targetLevel }, () => new Array<number>(targetLevel).fill(0));

  for (let i = 0; i < targetLevel; i++) {
    const baseRate = (BASE_SUCCESS_RATES[i] ?? 30) / 100;
    const pSuccess = Math.max(0, Math.min(1, baseRate * totalBonus));
    const failDest = protectFrom > 0 && i >= protectFrom ? i - 1 : 0;

    if (blessedTea) {
      const skipRatio = Math.max(0, Math.min(1, 0.01 * guzzlingBonus));
      const pSkip = pSuccess * skipRatio;
      const pNormal = pSuccess - pSkip;
      if (i + 1 < targetLevel) Q[i][i + 1] += pNormal;
      if (i + 2 < targetLevel) Q[i][i + 2] += pSkip;
      if (failDest < targetLevel) Q[i][failDest] += 1 - pSuccess;
    } else {
      if (i + 1 < targetLevel) Q[i][i + 1] += pSuccess;
      if (failDest < targetLevel) Q[i][failDest] += 1 - pSuccess;
    }

    for (let j = 0; j < targetLevel; j++) {
      iMinusQ[i][j] = (i === j ? 1 : 0) - Q[i][j];
    }
  }

  const M = invertMatrix(iMinusQ);
  if (!M) {
    if (markovCache.size >= MARKOV_CACHE_LIMIT) markovCache.clear();
    markovCache.set(cacheKey, null);
    return null;
  }

  let attempts = 0;
  for (let i = 0; i < targetLevel; i++) {
    attempts += M[start][i];
  }

  let protectionCount = 0;
  if (protectFrom > 0 && protectFrom < targetLevel) {
    for (let i = protectFrom; i < targetLevel; i++) {
      const failChance = Q[i][i - 1] ?? 0;
      protectionCount += M[start][i] * failChance;
    }
  }

  const res: MarkovResult = { attempts, protectionCount };
  if (markovCache.size >= MARKOV_CACHE_LIMIT) markovCache.clear();
  markovCache.set(cacheKey, res);
  return res;
}

