/**
 * Hardcoded EIP-1559 BaseFeeChangeDenominator (BFCD) values at hardfork blocks.
 * Used as compile-time fallback when DB is unavailable.
 */
export const KNOWN_EIP1559_PARAMS = [
  { blockNumber: 23850000n, baseFeeChangeDenominator: 8 },   // London hardfork
  { blockNumber: 38189056n, baseFeeChangeDenominator: 16 },  // Delhi hardfork (PIP-6)
  { blockNumber: 73440256n, baseFeeChangeDenominator: 64 },  // Bhilai hardfork (PIP-58)
] as const;

export interface Eip1559Param {
  blockNumber: bigint;
  baseFeeChangeDenominator: number;
}

// Gas target percentage defaults by era (before dynamic derivation was possible)
const DANDELI_BLOCK = 81424000n;

/**
 * Get the protocol-default gas target percentage for a given block number.
 * Pre-Dandeli: 50% (ElasticityMultiplier = 2)
 * Post-Dandeli: 65% (TargetGasPercentagePostDandeli)
 */
export function getDefaultGasTargetPct(blockNumber: bigint): number {
  return blockNumber < DANDELI_BLOCK ? 50.0 : 65.0;
}

/**
 * Binary-search sorted params list to find the BFCD effective at a given block number.
 * Returns the BFCD from the most recent params entry at or before blockNumber.
 */
export function getBfcdForBlock(
  blockNumber: bigint,
  params: Eip1559Param[]
): number | null {
  if (params.length === 0) return null;
  if (blockNumber < params[0].blockNumber) return null;

  let lo = 0;
  let hi = params.length - 1;
  let result = 0;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (params[mid].blockNumber <= blockNumber) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return params[result].baseFeeChangeDenominator;
}
