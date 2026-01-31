// Mock RPC client for testing

import type { TransactionReceipt } from 'viem';

export interface MockBlock {
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  timestamp: bigint;
  gasUsed: bigint;
  gasLimit: bigint;
  baseFeePerGas: bigint | null;
  transactions: Array<{
    hash: `0x${string}`;
    maxPriorityFeePerGas?: bigint | null;
    gasPrice?: bigint | null;
    gas: bigint;
    gasUsed?: bigint;
  }> | string[];
}

// Configurable responses
const blockResponses = new Map<bigint, MockBlock>();
const receiptResponses = new Map<bigint, TransactionReceipt[]>();
let latestBlockNumber = 50000000n;
let shouldFail = false;
let failCount = 0;
let maxFailures = 0;

export function resetMockRpc(): void {
  blockResponses.clear();
  receiptResponses.clear();
  latestBlockNumber = 50000000n;
  shouldFail = false;
  failCount = 0;
  maxFailures = 0;
}

export function setBlockResponse(blockNumber: bigint, block: MockBlock): void {
  blockResponses.set(blockNumber, block);
}

export function setReceiptResponse(blockNumber: bigint, receipts: TransactionReceipt[]): void {
  receiptResponses.set(blockNumber, receipts);
}

export function setLatestBlockNumber(blockNum: bigint): void {
  latestBlockNumber = blockNum;
}

export function setFailure(fail: boolean, maxFail = 0): void {
  shouldFail = fail;
  maxFailures = maxFail;
  failCount = 0;
}

function checkFailure(): void {
  if (shouldFail && (maxFailures === 0 || failCount < maxFailures)) {
    failCount++;
    throw new Error('Mock RPC failure');
  }
}

// Mock RpcClient class
export class MockRpcClient {
  private urls: string[];

  constructor(urls: string[]) {
    this.urls = urls;
  }

  get endpointCount(): number {
    return this.urls.length;
  }

  async getLatestBlockNumber(): Promise<bigint> {
    checkFailure();
    return latestBlockNumber;
  }

  async getBlock(blockNumber: bigint): Promise<MockBlock> {
    checkFailure();
    const block = blockResponses.get(blockNumber);
    if (!block) {
      throw new Error(`Block ${blockNumber} not found`);
    }
    return block;
  }

  async getBlockWithTransactions(blockNumber: bigint): Promise<MockBlock> {
    return this.getBlock(blockNumber);
  }

  async getBlocksWithTransactions(blockNumbers: bigint[]): Promise<Map<bigint, MockBlock>> {
    const results = new Map<bigint, MockBlock>();
    for (const num of blockNumbers) {
      try {
        const block = await this.getBlock(num);
        results.set(num, block);
      } catch {
        // Skip failed blocks
      }
    }
    return results;
  }

  async getBlocks(blockNumbers: bigint[]): Promise<Map<bigint, MockBlock>> {
    return this.getBlocksWithTransactions(blockNumbers);
  }

  async getBlockReceipts(blockNumber: bigint): Promise<TransactionReceipt[] | null> {
    checkFailure();
    return receiptResponses.get(blockNumber) ?? null;
  }

  async getBlocksReceipts(blockNumbers: bigint[]): Promise<Map<bigint, TransactionReceipt[]>> {
    const results = new Map<bigint, TransactionReceipt[]>();
    for (const num of blockNumbers) {
      const receipts = receiptResponses.get(num);
      if (receipts) {
        results.set(num, receipts);
      }
    }
    return results;
  }

  async call<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
    checkFailure();
    return fn({});
  }
}

export const mockGetRpcClient = jest.fn(() => new MockRpcClient(['https://rpc.test.com']));
