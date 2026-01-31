// Tests for blockChannel.ts - pub/sub functionality

import { blockChannel } from '../blockChannel';
import { createBlock } from './fixtures/blocks';

describe('BlockChannel', () => {
  beforeEach(() => {
    // Clear all subscribers before each test
    // We access the private listeners via subscriberCount to verify cleanup
    while (blockChannel.subscriberCount > 0) {
      // Force cleanup by creating and immediately unsubscribing
      const unsub = blockChannel.subscribe(() => {});
      unsub();
    }
  });

  describe('subscribe', () => {
    it('adds a listener and returns unsubscribe function', () => {
      const listener = jest.fn();

      const unsubscribe = blockChannel.subscribe(listener);

      expect(blockChannel.subscriberCount).toBe(1);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();
      expect(blockChannel.subscriberCount).toBe(0);
    });

    it('supports multiple subscribers', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      const unsub1 = blockChannel.subscribe(listener1);
      const unsub2 = blockChannel.subscribe(listener2);

      expect(blockChannel.subscriberCount).toBe(2);

      unsub1();
      expect(blockChannel.subscriberCount).toBe(1);

      unsub2();
      expect(blockChannel.subscriberCount).toBe(0);
    });
  });

  describe('publish', () => {
    it('notifies all subscribers with the block', () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      blockChannel.subscribe(listener1);
      blockChannel.subscribe(listener2);

      const block = createBlock({ blockNumber: 12345n });
      blockChannel.publish(block);

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener1).toHaveBeenCalledWith(block);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledWith(block);
    });

    it('does not notify unsubscribed listeners', () => {
      const listener = jest.fn();
      const unsubscribe = blockChannel.subscribe(listener);

      unsubscribe();

      const block = createBlock();
      blockChannel.publish(block);

      expect(listener).not.toHaveBeenCalled();
    });

    it('continues notifying other listeners if one throws', () => {
      const errorListener = jest.fn(() => {
        throw new Error('Listener error');
      });
      const successListener = jest.fn();

      blockChannel.subscribe(errorListener);
      blockChannel.subscribe(successListener);

      const block = createBlock();

      // Should not throw
      expect(() => blockChannel.publish(block)).not.toThrow();

      expect(errorListener).toHaveBeenCalledTimes(1);
      expect(successListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('publishBatch', () => {
    it('publishes blocks in order', () => {
      const receivedBlocks: bigint[] = [];
      blockChannel.subscribe((block) => {
        receivedBlocks.push(block.blockNumber);
      });

      const blocks = [
        createBlock({ blockNumber: 100n }),
        createBlock({ blockNumber: 101n }),
        createBlock({ blockNumber: 102n }),
      ];

      blockChannel.publishBatch(blocks);

      expect(receivedBlocks).toEqual([100n, 101n, 102n]);
    });

    it('calls listener once per block', () => {
      const listener = jest.fn();
      blockChannel.subscribe(listener);

      const blocks = [
        createBlock({ blockNumber: 1n }),
        createBlock({ blockNumber: 2n }),
        createBlock({ blockNumber: 3n }),
      ];

      blockChannel.publishBatch(blocks);

      expect(listener).toHaveBeenCalledTimes(3);
    });
  });

  describe('subscriberCount', () => {
    it('returns 0 when no subscribers', () => {
      expect(blockChannel.subscriberCount).toBe(0);
    });

    it('tracks subscriber count accurately', () => {
      const unsub1 = blockChannel.subscribe(() => {});
      expect(blockChannel.subscriberCount).toBe(1);

      const unsub2 = blockChannel.subscribe(() => {});
      expect(blockChannel.subscriberCount).toBe(2);

      unsub1();
      expect(blockChannel.subscriberCount).toBe(1);

      unsub2();
      expect(blockChannel.subscriberCount).toBe(0);
    });
  });
});
