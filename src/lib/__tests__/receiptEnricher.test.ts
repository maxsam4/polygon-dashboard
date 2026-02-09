// Mock dependencies before imports
jest.mock('../rpc', () => ({
  getRpcClient: jest.fn(),
}));

jest.mock('../liveStreamClient', () => ({
  pushBlockUpdates: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../indexers/priorityFeeBackfill', () => ({
  calculatePriorityFeeMetrics: jest.fn(),
}));

import { enrichBlocksWithReceipts } from '../indexers/receiptEnricher';
import { getRpcClient } from '../rpc';
import { pushBlockUpdates } from '../liveStreamClient';
import { calculatePriorityFeeMetrics } from '../indexers/priorityFeeBackfill';
import { Block } from '../types';

const mockGetRpcClient = getRpcClient as jest.MockedFunction<typeof getRpcClient>;
const mockPushBlockUpdates = pushBlockUpdates as jest.MockedFunction<typeof pushBlockUpdates>;
const mockCalculatePriorityFeeMetrics = calculatePriorityFeeMetrics as jest.MockedFunction<typeof calculatePriorityFeeMetrics>;

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    blockNumber: 100n,
    timestamp: new Date('2024-01-01T00:00:00Z'),
    blockHash: '0xabc',
    parentHash: '0xdef',
    gasUsed: 1000000n,
    gasLimit: 30000000n,
    baseFeeGwei: 25,
    minPriorityFeeGwei: 1,
    maxPriorityFeeGwei: 5,
    avgPriorityFeeGwei: null,
    medianPriorityFeeGwei: 2,
    totalBaseFeeGwei: 100,
    totalPriorityFeeGwei: null,
    txCount: 10,
    blockTimeSec: 2,
    mgasPerSec: 0.5,
    tps: 5,
    finalized: false,
    finalizedAt: null,
    milestoneId: null,
    timeToFinalitySec: null,
    ...overrides,
  };
}

describe('enrichBlocksWithReceipts', () => {
  let mockRpc: { getBlocksReceiptsReliably: jest.Mock };
  const signal = AbortSignal.timeout(5000);

  beforeEach(() => {
    jest.clearAllMocks();
    mockRpc = { getBlocksReceiptsReliably: jest.fn() };
    mockGetRpcClient.mockReturnValue(mockRpc as unknown as ReturnType<typeof getRpcClient>);
    mockPushBlockUpdates.mockResolvedValue(undefined);
  });

  it('returns early for blocks with no transactions', async () => {
    const blocks = [makeBlock({ txCount: 0 })];

    const result = await enrichBlocksWithReceipts(blocks, { signal });

    expect(result.enrichedCount).toBe(0);
    expect(mockRpc.getBlocksReceiptsReliably).not.toHaveBeenCalled();
  });

  it('enriches blocks with receipt-based priority fees', async () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const mockReceipts = [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }];

    mockRpc.getBlocksReceiptsReliably.mockResolvedValue(new Map([[100n, mockReceipts]]));
    mockCalculatePriorityFeeMetrics.mockReturnValue({
      minPriorityFeeGwei: 0.5,
      maxPriorityFeeGwei: 3,
      avgPriorityFeeGwei: 1.5,
      medianPriorityFeeGwei: 1,
      totalPriorityFeeGwei: 50,
    });

    const result = await enrichBlocksWithReceipts(blocks, { signal });

    expect(result.enrichedCount).toBe(1);
    // Verify in-place mutation
    expect(blocks[0].avgPriorityFeeGwei).toBe(1.5);
    expect(blocks[0].totalPriorityFeeGwei).toBe(50);
    expect(blocks[0].minPriorityFeeGwei).toBe(0.5);
    expect(blocks[0].maxPriorityFeeGwei).toBe(3);
    expect(blocks[0].medianPriorityFeeGwei).toBe(1);
  });

  it('handles mixed blocks with and without transactions', async () => {
    const blocks = [
      makeBlock({ blockNumber: 100n, txCount: 5 }),
      makeBlock({ blockNumber: 101n, txCount: 0 }),
      makeBlock({ blockNumber: 102n, txCount: 3 }),
    ];

    mockRpc.getBlocksReceiptsReliably.mockResolvedValue(
      new Map([
        [100n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }]],
        [102n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }]],
      ])
    );
    mockCalculatePriorityFeeMetrics.mockReturnValue({
      minPriorityFeeGwei: 0.5,
      maxPriorityFeeGwei: 3,
      avgPriorityFeeGwei: 1.5,
      medianPriorityFeeGwei: 1,
      totalPriorityFeeGwei: 50,
    });

    const result = await enrichBlocksWithReceipts(blocks, { signal });

    expect(result.enrichedCount).toBe(2);
    // Only blocks with txCount > 0 should be sent to RPC
    expect(mockRpc.getBlocksReceiptsReliably).toHaveBeenCalledWith([100n, 102n], signal);
  });

  it('pushes updates to live-stream when option is set', async () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const mockReceipts = [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }];

    mockRpc.getBlocksReceiptsReliably.mockResolvedValue(new Map([[100n, mockReceipts]]));
    mockCalculatePriorityFeeMetrics.mockReturnValue({
      minPriorityFeeGwei: 0.5,
      maxPriorityFeeGwei: 3,
      avgPriorityFeeGwei: 1.5,
      medianPriorityFeeGwei: 1,
      totalPriorityFeeGwei: 50,
    });

    await enrichBlocksWithReceipts(blocks, { pushToLiveStream: true, signal });

    expect(mockPushBlockUpdates).toHaveBeenCalledWith([
      {
        blockNumber: 100,
        txCount: 5,
        minPriorityFeeGwei: 0.5,
        maxPriorityFeeGwei: 3,
        avgPriorityFeeGwei: 1.5,
        medianPriorityFeeGwei: 1,
        totalPriorityFeeGwei: 50,
      },
    ]);
  });

  it('does not push to live-stream by default', async () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const mockReceipts = [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }];

    mockRpc.getBlocksReceiptsReliably.mockResolvedValue(new Map([[100n, mockReceipts]]));
    mockCalculatePriorityFeeMetrics.mockReturnValue({
      minPriorityFeeGwei: 0.5,
      maxPriorityFeeGwei: 3,
      avgPriorityFeeGwei: 1.5,
      medianPriorityFeeGwei: 1,
      totalPriorityFeeGwei: 50,
    });

    await enrichBlocksWithReceipts(blocks, { signal });

    expect(mockPushBlockUpdates).not.toHaveBeenCalled();
  });

  it('throws on abort', async () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const abortController = new AbortController();
    abortController.abort();

    mockRpc.getBlocksReceiptsReliably.mockRejectedValue(
      new DOMException('Aborted', 'AbortError')
    );

    await expect(
      enrichBlocksWithReceipts(blocks, { signal: abortController.signal })
    ).rejects.toThrow('Aborted');
  });

  it('returns empty results for empty blocks array', async () => {
    const result = await enrichBlocksWithReceipts([], { signal });

    expect(result.enrichedCount).toBe(0);
    expect(mockRpc.getBlocksReceiptsReliably).not.toHaveBeenCalled();
  });
});
