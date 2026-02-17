// Mock dependencies before imports
jest.mock('../rpc', () => ({
  getRpcClient: jest.fn(),
}));

jest.mock('../liveStreamClient', () => ({
  pushBlockUpdates: jest.fn().mockResolvedValue(undefined),
}));

import { enrichBlocksWithReceipts, applyReceiptsToBlocks } from '../indexers/receiptEnricher';
import { getRpcClient, TransactionReceipt } from '../rpc';
import { pushBlockUpdates } from '../liveStreamClient';
import { Block } from '../types';

const mockGetRpcClient = getRpcClient as jest.MockedFunction<typeof getRpcClient>;
const mockPushBlockUpdates = pushBlockUpdates as jest.MockedFunction<typeof pushBlockUpdates>;

// With baseFeeGwei=25 and effectiveGasPrice=30 Gwei, priority fee = 5 Gwei
// totalPriorityFee = 5 Gwei * 21000 gas = 105000 Gwei
const EXPECTED_PRIORITY_FEE = 5;
const EXPECTED_TOTAL = 105000;

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

    const result = await enrichBlocksWithReceipts(blocks, { signal });

    expect(result.enrichedCount).toBe(1);
    // Verify in-place mutation
    expect(blocks[0].avgPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
    expect(blocks[0].totalPriorityFeeGwei).toBe(EXPECTED_TOTAL);
    expect(blocks[0].minPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
    expect(blocks[0].maxPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
    expect(blocks[0].medianPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
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

    const result = await enrichBlocksWithReceipts(blocks, { signal });

    expect(result.enrichedCount).toBe(2);
    // Only blocks with txCount > 0 should be sent to RPC
    expect(mockRpc.getBlocksReceiptsReliably).toHaveBeenCalledWith([100n, 102n], signal);
  });

  it('pushes updates to live-stream when option is set', async () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const mockReceipts = [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }];

    mockRpc.getBlocksReceiptsReliably.mockResolvedValue(new Map([[100n, mockReceipts]]));

    await enrichBlocksWithReceipts(blocks, { pushToLiveStream: true, signal });

    expect(mockPushBlockUpdates).toHaveBeenCalledWith([
      {
        blockNumber: 100,
        txCount: 5,
        minPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        maxPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        avgPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        medianPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        totalPriorityFeeGwei: EXPECTED_TOTAL,
      },
    ]);
  });

  it('does not push to live-stream by default', async () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const mockReceipts = [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n }];

    mockRpc.getBlocksReceiptsReliably.mockResolvedValue(new Map([[100n, mockReceipts]]));

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

describe('applyReceiptsToBlocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPushBlockUpdates.mockResolvedValue(undefined);
  });

  it('enriches blocks with pre-fetched receipts', () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const receiptsMap = new Map<bigint, TransactionReceipt[]>([
      [100n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n } as TransactionReceipt]],
    ]);

    const result = applyReceiptsToBlocks(blocks, receiptsMap);

    expect(result.enrichedCount).toBe(1);
    expect(blocks[0].avgPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
    expect(blocks[0].totalPriorityFeeGwei).toBe(EXPECTED_TOTAL);
    expect(blocks[0].minPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
    expect(blocks[0].maxPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
    expect(blocks[0].medianPriorityFeeGwei).toBe(EXPECTED_PRIORITY_FEE);
  });

  it('skips blocks with 0 transactions', () => {
    const blocks = [
      makeBlock({ blockNumber: 100n, txCount: 5 }),
      makeBlock({ blockNumber: 101n, txCount: 0 }),
      makeBlock({ blockNumber: 102n, txCount: 3 }),
    ];
    const receiptsMap = new Map<bigint, TransactionReceipt[]>([
      [100n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n } as TransactionReceipt]],
      [101n, []],
      [102n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n } as TransactionReceipt]],
    ]);

    const result = applyReceiptsToBlocks(blocks, receiptsMap);

    expect(result.enrichedCount).toBe(2);
  });

  it('returns 0 enriched for all-empty-tx blocks', () => {
    const blocks = [makeBlock({ txCount: 0 })];
    const receiptsMap = new Map<bigint, TransactionReceipt[]>();

    const result = applyReceiptsToBlocks(blocks, receiptsMap);

    expect(result.enrichedCount).toBe(0);
  });

  it('pushes to live stream when option is set', () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const receiptsMap = new Map<bigint, TransactionReceipt[]>([
      [100n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n } as TransactionReceipt]],
    ]);

    applyReceiptsToBlocks(blocks, receiptsMap, { pushToLiveStream: true });

    expect(mockPushBlockUpdates).toHaveBeenCalledWith([
      {
        blockNumber: 100,
        txCount: 5,
        minPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        maxPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        avgPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        medianPriorityFeeGwei: EXPECTED_PRIORITY_FEE,
        totalPriorityFeeGwei: EXPECTED_TOTAL,
      },
    ]);
  });

  it('does not push to live stream by default', () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const receiptsMap = new Map<bigint, TransactionReceipt[]>([
      [100n, [{ effectiveGasPrice: 30000000000n, gasUsed: 21000n } as TransactionReceipt]],
    ]);

    applyReceiptsToBlocks(blocks, receiptsMap);

    expect(mockPushBlockUpdates).not.toHaveBeenCalled();
  });

  it('handles missing receipts in map gracefully', () => {
    const blocks = [makeBlock({ blockNumber: 100n, txCount: 5 })];
    const receiptsMap = new Map<bigint, TransactionReceipt[]>(); // Empty map - no receipts

    const result = applyReceiptsToBlocks(blocks, receiptsMap);

    expect(result.enrichedCount).toBe(0);
  });
});
