import { SequenceCache } from '../../indexers/sequenceCache';

describe('SequenceCache', () => {
  describe('basic operations', () => {
    it('should add and check sequence IDs', () => {
      const cache = new SequenceCache();

      cache.add(100);
      cache.add(101);
      cache.add(102);

      expect(cache.has(100)).toBe(true);
      expect(cache.has(101)).toBe(true);
      expect(cache.has(102)).toBe(true);
      expect(cache.has(99)).toBe(false);
      expect(cache.has(103)).toBe(false);
    });

    it('should report correct size', () => {
      const cache = new SequenceCache();

      expect(cache.size).toBe(0);

      cache.add(1);
      expect(cache.size).toBe(1);

      cache.add(2);
      cache.add(3);
      expect(cache.size).toBe(3);
    });

    it('should clear all entries', () => {
      const cache = new SequenceCache();

      cache.add(100);
      cache.add(101);
      cache.add(102);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has(100)).toBe(false);
      expect(cache.has(101)).toBe(false);
      expect(cache.has(102)).toBe(false);
    });
  });

  describe('duplicate handling', () => {
    it('should not add duplicates', () => {
      const cache = new SequenceCache();

      cache.add(100);
      cache.add(100);
      cache.add(100);

      expect(cache.size).toBe(1);
      expect(cache.has(100)).toBe(true);
    });

    it('should not affect order when adding duplicate', () => {
      const cache = new SequenceCache(3);

      cache.add(1);
      cache.add(2);
      cache.add(1); // duplicate, should not change order

      // Add more to trigger eviction
      cache.add(3);
      cache.add(4);

      // 1 was added first, so it should be evicted first
      expect(cache.has(1)).toBe(false);
      expect(cache.has(2)).toBe(true);
      expect(cache.has(3)).toBe(true);
      expect(cache.has(4)).toBe(true);
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when at capacity', () => {
      const cache = new SequenceCache(3);

      cache.add(1);
      cache.add(2);
      cache.add(3);
      expect(cache.size).toBe(3);

      // Adding 4th element should evict 1 (oldest)
      cache.add(4);
      expect(cache.size).toBe(3);
      expect(cache.has(1)).toBe(false);
      expect(cache.has(2)).toBe(true);
      expect(cache.has(3)).toBe(true);
      expect(cache.has(4)).toBe(true);
    });

    it('should evict multiple entries in FIFO order', () => {
      const cache = new SequenceCache(3);

      cache.add(1);
      cache.add(2);
      cache.add(3);

      cache.add(4); // evicts 1
      cache.add(5); // evicts 2
      cache.add(6); // evicts 3

      expect(cache.has(1)).toBe(false);
      expect(cache.has(2)).toBe(false);
      expect(cache.has(3)).toBe(false);
      expect(cache.has(4)).toBe(true);
      expect(cache.has(5)).toBe(true);
      expect(cache.has(6)).toBe(true);
    });

    it('should respect custom maxSize', () => {
      const cache = new SequenceCache(5);

      for (let i = 1; i <= 10; i++) {
        cache.add(i);
      }

      expect(cache.size).toBe(5);

      // Only the last 5 should remain
      for (let i = 1; i <= 5; i++) {
        expect(cache.has(i)).toBe(false);
      }
      for (let i = 6; i <= 10; i++) {
        expect(cache.has(i)).toBe(true);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle maxSize of 1', () => {
      const cache = new SequenceCache(1);

      cache.add(100);
      expect(cache.has(100)).toBe(true);

      cache.add(101);
      expect(cache.has(100)).toBe(false);
      expect(cache.has(101)).toBe(true);
      expect(cache.size).toBe(1);
    });

    it('should handle negative sequence IDs', () => {
      const cache = new SequenceCache();

      cache.add(-1);
      cache.add(0);
      cache.add(1);

      expect(cache.has(-1)).toBe(true);
      expect(cache.has(0)).toBe(true);
      expect(cache.has(1)).toBe(true);
    });

    it('should handle large sequence IDs', () => {
      const cache = new SequenceCache();
      const largeId = 2147483647; // Max 32-bit integer

      cache.add(largeId);
      expect(cache.has(largeId)).toBe(true);
    });
  });
});
