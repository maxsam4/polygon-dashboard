import type { StreamBlock } from './types.js';

/**
 * Circular buffer for storing the most recent N blocks.
 * Deduplicates by block number (first arrival wins).
 */
export class RingBuffer {
  private buffer: Map<number, StreamBlock> = new Map();
  private readonly capacity: number;

  constructor(capacity: number = 25) {
    this.capacity = capacity;
  }

  /**
   * Add a block to the buffer.
   * Returns true if the block was added, false if it was a duplicate.
   */
  push(block: StreamBlock): boolean {
    // Deduplicate: first arrival wins
    if (this.buffer.has(block.blockNumber)) {
      return false;
    }

    this.buffer.set(block.blockNumber, block);

    // Remove oldest blocks if over capacity
    if (this.buffer.size > this.capacity) {
      const sortedNumbers = Array.from(this.buffer.keys()).sort((a, b) => a - b);
      const removeCount = this.buffer.size - this.capacity;
      for (let i = 0; i < removeCount; i++) {
        this.buffer.delete(sortedNumbers[i]);
      }
    }

    return true;
  }

  /**
   * Get all blocks sorted by block number (ascending).
   */
  getAll(): StreamBlock[] {
    return Array.from(this.buffer.values()).sort(
      (a, b) => a.blockNumber - b.blockNumber
    );
  }

  /**
   * Get the highest block number in the buffer.
   */
  getHighest(): number | null {
    if (this.buffer.size === 0) return null;
    return Math.max(...this.buffer.keys());
  }

  /**
   * Get a specific block by number.
   */
  get(blockNumber: number): StreamBlock | undefined {
    return this.buffer.get(blockNumber);
  }

  /**
   * Get the number of blocks in the buffer.
   */
  get size(): number {
    return this.buffer.size;
  }

  /**
   * Clear all blocks from the buffer.
   */
  clear(): void {
    this.buffer.clear();
  }

  /**
   * Calculate block time for a new block using previous block in buffer.
   */
  calculateBlockTime(blockNumber: number, timestamp: number): number | null {
    const prevBlock = this.buffer.get(blockNumber - 1);
    if (!prevBlock) return null;
    return timestamp - prevBlock.timestamp;
  }

  /**
   * Update an existing block with partial updates.
   * Returns true if the block was found and updated, false otherwise.
   */
  update(blockNumber: number, updates: Partial<StreamBlock>): boolean {
    const existing = this.buffer.get(blockNumber);
    if (!existing) return false;

    const updated = { ...existing, ...updates };
    this.buffer.set(blockNumber, updated);
    return true;
  }
}
