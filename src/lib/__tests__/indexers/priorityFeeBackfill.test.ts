import { calculatePriorityFeeMetrics } from '../../indexers/priorityFeeBackfill';
import { TransactionReceipt } from '../../rpc';
import { GWEI } from '../../constants';

// Helper to create mock receipts
function createMockReceipt(overrides: Partial<{
  effectiveGasPrice: bigint;
  gasUsed: bigint;
}>): TransactionReceipt {
  return {
    transactionHash: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`,
    transactionIndex: 0,
    blockHash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as `0x${string}`,
    blockNumber: 1000n,
    from: '0x1234567890123456789012345678901234567890' as `0x${string}`,
    to: '0x0987654321098765432109876543210987654321' as `0x${string}`,
    cumulativeGasUsed: 21000n,
    gasUsed: overrides.gasUsed ?? 21000n,
    effectiveGasPrice: overrides.effectiveGasPrice ?? 50n * GWEI,
    contractAddress: null,
    logs: [],
    logsBloom: '0x00' as `0x${string}`,
    status: 'success',
    type: '0x2' as TransactionReceipt['type'],
    root: undefined,
    blobGasPrice: undefined,
    blobGasUsed: undefined,
  };
}

describe('calculatePriorityFeeMetrics', () => {
  describe('empty receipts', () => {
    it('returns null metrics for empty receipts array', () => {
      const result = calculatePriorityFeeMetrics([], 100);

      expect(result.minPriorityFeeGwei).toBe(0);
      expect(result.maxPriorityFeeGwei).toBe(0);
      expect(result.avgPriorityFeeGwei).toBeNull();
      expect(result.medianPriorityFeeGwei).toBe(0);
      expect(result.totalPriorityFeeGwei).toBeNull();
    });
  });

  describe('single transaction', () => {
    it('calculates metrics for a single transaction with priority fee', () => {
      // Base fee: 30 Gwei, Effective gas price: 50 Gwei -> Priority fee: 20 Gwei
      const baseFeeGwei = 30;
      const effectiveGasPriceGwei = 50;
      const gasUsed = 21000n;

      const receipts = [
        createMockReceipt({
          effectiveGasPrice: BigInt(effectiveGasPriceGwei) * GWEI,
          gasUsed,
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      // Priority fee per gas = 50 - 30 = 20 Gwei
      expect(result.minPriorityFeeGwei).toBe(20);
      expect(result.maxPriorityFeeGwei).toBe(20);
      expect(result.medianPriorityFeeGwei).toBe(20);
      // Avg = total priority / total gas = (20 Gwei * 21000) / 21000 = 20 Gwei
      expect(result.avgPriorityFeeGwei).toBe(20);
      // Total = 20 Gwei/gas * 21000 gas = 420000 Gwei
      expect(result.totalPriorityFeeGwei).toBe(420000);
    });

    it('handles zero priority fee when effective gas price equals base fee', () => {
      const baseFeeGwei = 30;

      const receipts = [
        createMockReceipt({
          effectiveGasPrice: BigInt(baseFeeGwei) * GWEI,
          gasUsed: 21000n,
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      expect(result.minPriorityFeeGwei).toBe(0);
      expect(result.maxPriorityFeeGwei).toBe(0);
      expect(result.medianPriorityFeeGwei).toBe(0);
      expect(result.avgPriorityFeeGwei).toBe(0);
      expect(result.totalPriorityFeeGwei).toBe(0);
    });

    it('treats priority fee as zero when effective gas price is below base fee', () => {
      // Edge case: effectiveGasPrice < baseFee (shouldn't normally happen, but handle gracefully)
      const baseFeeGwei = 50;
      const effectiveGasPriceGwei = 30; // Below base fee

      const receipts = [
        createMockReceipt({
          effectiveGasPrice: BigInt(effectiveGasPriceGwei) * GWEI,
          gasUsed: 21000n,
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      // Priority fee should be 0, not negative
      expect(result.minPriorityFeeGwei).toBe(0);
      expect(result.maxPriorityFeeGwei).toBe(0);
      expect(result.medianPriorityFeeGwei).toBe(0);
      expect(result.avgPriorityFeeGwei).toBe(0);
      expect(result.totalPriorityFeeGwei).toBe(0);
    });
  });

  describe('multiple transactions', () => {
    it('calculates correct min, max, avg, and median for multiple transactions', () => {
      const baseFeeGwei = 20;

      // Three transactions with different priority fees: 10, 30, 50 Gwei
      const receipts = [
        createMockReceipt({
          effectiveGasPrice: 30n * GWEI, // priority: 10 Gwei
          gasUsed: 21000n,
        }),
        createMockReceipt({
          effectiveGasPrice: 50n * GWEI, // priority: 30 Gwei
          gasUsed: 21000n,
        }),
        createMockReceipt({
          effectiveGasPrice: 70n * GWEI, // priority: 50 Gwei
          gasUsed: 21000n,
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      expect(result.minPriorityFeeGwei).toBe(10);
      expect(result.maxPriorityFeeGwei).toBe(50);
      // Median of [10, 30, 50] = 30
      expect(result.medianPriorityFeeGwei).toBe(30);
      // Total priority fee = (10 + 30 + 50) * 21000 = 1890000 Gwei
      // Avg = 1890000 / (21000 * 3) = 30 Gwei
      expect(result.avgPriorityFeeGwei).toBe(30);
      expect(result.totalPriorityFeeGwei).toBe(1890000);
    });

    it('calculates correct median for even number of transactions', () => {
      const baseFeeGwei = 10;

      // Four transactions with priority fees: 10, 20, 30, 40 Gwei
      const receipts = [
        createMockReceipt({ effectiveGasPrice: 20n * GWEI, gasUsed: 21000n }), // priority: 10
        createMockReceipt({ effectiveGasPrice: 30n * GWEI, gasUsed: 21000n }), // priority: 20
        createMockReceipt({ effectiveGasPrice: 40n * GWEI, gasUsed: 21000n }), // priority: 30
        createMockReceipt({ effectiveGasPrice: 50n * GWEI, gasUsed: 21000n }), // priority: 40
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      // Median of [10, 20, 30, 40] = (20 + 30) / 2 = 25
      expect(result.medianPriorityFeeGwei).toBe(25);
    });

    it('weights average by gas used', () => {
      const baseFeeGwei = 10;

      // Two transactions: one uses more gas
      const receipts = [
        createMockReceipt({
          effectiveGasPrice: 20n * GWEI, // priority: 10 Gwei
          gasUsed: 100000n, // High gas usage
        }),
        createMockReceipt({
          effectiveGasPrice: 60n * GWEI, // priority: 50 Gwei
          gasUsed: 21000n, // Low gas usage
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      // Total priority = (10 * 100000) + (50 * 21000) = 1000000 + 1050000 = 2050000 Gwei
      // Total gas = 100000 + 21000 = 121000
      // Avg = 2050000 / 121000 ≈ 16.94 Gwei (weighted towards the lower priority fee)
      expect(result.avgPriorityFeeGwei).toBeCloseTo(16.94, 1);
      expect(result.totalPriorityFeeGwei).toBe(2050000);
    });
  });

  describe('edge cases', () => {
    it('handles very large gas values without overflow', () => {
      const baseFeeGwei = 100;
      const veryHighGas = 30000000n; // 30M gas (full block)

      const receipts = [
        createMockReceipt({
          effectiveGasPrice: 150n * GWEI, // priority: 50 Gwei
          gasUsed: veryHighGas,
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      expect(result.minPriorityFeeGwei).toBe(50);
      expect(result.maxPriorityFeeGwei).toBe(50);
      // Total = 50 Gwei * 30M = 1.5B Gwei
      expect(result.totalPriorityFeeGwei).toBe(1500000000);
    });

    it('handles fractional gwei base fees', () => {
      const baseFeeGwei = 25.5; // Fractional base fee

      const receipts = [
        createMockReceipt({
          effectiveGasPrice: 50n * GWEI, // 50 Gwei effective
          gasUsed: 21000n,
        }),
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      // Priority = 50 - 25.5 = 24.5 Gwei
      // Due to integer math in Wei conversion, result may be slightly off
      expect(result.minPriorityFeeGwei).toBeCloseTo(24.5, 0);
    });

    it('handles unsorted priority fees correctly for median', () => {
      const baseFeeGwei = 10;

      // Receipts in random order
      const receipts = [
        createMockReceipt({ effectiveGasPrice: 60n * GWEI, gasUsed: 21000n }), // priority: 50
        createMockReceipt({ effectiveGasPrice: 20n * GWEI, gasUsed: 21000n }), // priority: 10
        createMockReceipt({ effectiveGasPrice: 40n * GWEI, gasUsed: 21000n }), // priority: 30
      ];

      const result = calculatePriorityFeeMetrics(receipts, baseFeeGwei);

      // Should sort to [10, 30, 50] and return median 30
      expect(result.medianPriorityFeeGwei).toBe(30);
    });
  });
});
