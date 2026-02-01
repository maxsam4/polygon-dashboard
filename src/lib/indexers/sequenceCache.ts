/**
 * SequenceCache - LRU cache for tracking recently inserted sequence IDs.
 *
 * Used by MilestoneIndexer to efficiently check if a predecessor milestone
 * exists without hitting the database for every check.
 */
export class SequenceCache {
  private cache: Set<number>;
  private insertOrder: number[];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.cache = new Set();
    this.insertOrder = [];
    this.maxSize = maxSize;
  }

  /**
   * Check if a sequence ID exists in the cache.
   */
  has(sequenceId: number): boolean {
    return this.cache.has(sequenceId);
  }

  /**
   * Add a sequence ID to the cache with LRU eviction.
   */
  add(sequenceId: number): void {
    // Don't add duplicates
    if (this.cache.has(sequenceId)) {
      return;
    }

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.insertOrder.shift();
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.add(sequenceId);
    this.insertOrder.push(sequenceId);
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.cache.clear();
    this.insertOrder = [];
  }

  /**
   * Get the current size of the cache.
   */
  get size(): number {
    return this.cache.size;
  }
}
