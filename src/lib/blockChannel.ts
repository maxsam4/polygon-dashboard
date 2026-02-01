import { Block } from './types';

type BlockListener = (block: Block) => void;

/**
 * In-memory pub/sub channel for real-time block updates.
 * LivePoller publishes blocks here, SSE endpoints subscribe.
 */
class BlockChannel {
  private listeners: Set<BlockListener> = new Set();

  /**
   * Subscribe to new block notifications.
   * Returns an unsubscribe function.
   */
  subscribe(listener: BlockListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Publish a new block to all subscribers.
   */
  publish(block: Block): void {
    for (const listener of this.listeners) {
      try {
        listener(block);
      } catch (error) {
        console.error('[BlockChannel] Error in listener:', error);
      }
    }
  }

  /**
   * Publish multiple blocks to all subscribers.
   */
  publishBatch(blocks: Block[]): void {
    for (const block of blocks) {
      this.publish(block);
    }
  }

  /**
   * Get the number of active subscribers.
   */
  get subscriberCount(): number {
    return this.listeners.size;
  }

  /**
   * Clear all subscribers. Used for testing cleanup.
   */
  clear(): void {
    this.listeners.clear();
  }
}

// Singleton instance
export const blockChannel = new BlockChannel();
