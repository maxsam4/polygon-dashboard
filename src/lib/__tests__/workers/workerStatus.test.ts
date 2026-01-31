// Tests for workers/workerStatus.ts

import {
  initWorkerStatus,
  updateWorkerState,
  updateWorkerRun,
  updateWorkerError,
  getAllWorkerStatuses,
  getWorkerStatus,
} from '../../workers/workerStatus';

describe('workerStatus', () => {
  beforeEach(() => {
    // Clear global state
    const globalState = globalThis as typeof globalThis & {
      __workerStatuses?: Map<string, unknown>;
    };
    globalState.__workerStatuses = undefined;
  });

  describe('initWorkerStatus', () => {
    it('initializes worker with default values', () => {
      initWorkerStatus('TestWorker');

      const status = getWorkerStatus('TestWorker');
      expect(status).toEqual({
        name: 'TestWorker',
        state: 'stopped',
        lastRunAt: null,
        lastErrorAt: null,
        lastError: null,
        itemsProcessed: 0,
      });
    });

    it('does not overwrite existing status', () => {
      initWorkerStatus('TestWorker');
      updateWorkerRun('TestWorker', 10);

      initWorkerStatus('TestWorker');

      const status = getWorkerStatus('TestWorker');
      expect(status?.itemsProcessed).toBe(10);
    });
  });

  describe('updateWorkerState', () => {
    it('updates state to running', () => {
      initWorkerStatus('TestWorker');

      updateWorkerState('TestWorker', 'running');

      const status = getWorkerStatus('TestWorker');
      expect(status?.state).toBe('running');
      expect(status?.lastRunAt).toBeInstanceOf(Date);
    });

    it('updates state to idle', () => {
      initWorkerStatus('TestWorker');

      updateWorkerState('TestWorker', 'idle');

      const status = getWorkerStatus('TestWorker');
      expect(status?.state).toBe('idle');
    });

    it('updates state to error', () => {
      initWorkerStatus('TestWorker');

      updateWorkerState('TestWorker', 'error');

      const status = getWorkerStatus('TestWorker');
      expect(status?.state).toBe('error');
    });

    it('sets lastRunAt when state becomes running', () => {
      initWorkerStatus('TestWorker');

      const beforeUpdate = Date.now();
      updateWorkerState('TestWorker', 'running');
      const afterUpdate = Date.now();

      const status = getWorkerStatus('TestWorker');
      const lastRunTime = status?.lastRunAt?.getTime() ?? 0;
      expect(lastRunTime).toBeGreaterThanOrEqual(beforeUpdate);
      expect(lastRunTime).toBeLessThanOrEqual(afterUpdate);
    });

    it('does not update non-existent worker', () => {
      updateWorkerState('NonExistent', 'running');

      expect(getWorkerStatus('NonExistent')).toBeUndefined();
    });
  });

  describe('updateWorkerRun', () => {
    it('updates lastRunAt and increments itemsProcessed', () => {
      initWorkerStatus('TestWorker');

      updateWorkerRun('TestWorker', 5);

      const status = getWorkerStatus('TestWorker');
      expect(status?.itemsProcessed).toBe(5);
      expect(status?.lastRunAt).toBeInstanceOf(Date);
    });

    it('accumulates itemsProcessed', () => {
      initWorkerStatus('TestWorker');

      updateWorkerRun('TestWorker', 5);
      updateWorkerRun('TestWorker', 3);
      updateWorkerRun('TestWorker', 2);

      const status = getWorkerStatus('TestWorker');
      expect(status?.itemsProcessed).toBe(10);
    });

    it('defaults to 0 items', () => {
      initWorkerStatus('TestWorker');
      const initialItems = getWorkerStatus('TestWorker')?.itemsProcessed;

      updateWorkerRun('TestWorker');

      const status = getWorkerStatus('TestWorker');
      expect(status?.itemsProcessed).toBe(initialItems);
    });
  });

  describe('updateWorkerError', () => {
    it('sets state to error and records error info', () => {
      initWorkerStatus('TestWorker');

      updateWorkerError('TestWorker', 'Connection failed');

      const status = getWorkerStatus('TestWorker');
      expect(status?.state).toBe('error');
      expect(status?.lastError).toBe('Connection failed');
      expect(status?.lastErrorAt).toBeInstanceOf(Date);
    });

    it('updates error timestamp on each error', () => {
      initWorkerStatus('TestWorker');

      updateWorkerError('TestWorker', 'Error 1');
      const firstErrorTime = getWorkerStatus('TestWorker')?.lastErrorAt;

      // Small delay to ensure different timestamp
      jest.useFakeTimers();
      jest.advanceTimersByTime(1000);

      updateWorkerError('TestWorker', 'Error 2');
      const secondErrorTime = getWorkerStatus('TestWorker')?.lastErrorAt;

      jest.useRealTimers();

      expect(getWorkerStatus('TestWorker')?.lastError).toBe('Error 2');
      // Timestamps should be different
      expect(secondErrorTime?.getTime()).toBeGreaterThan(firstErrorTime?.getTime() ?? 0);
    });
  });

  describe('getAllWorkerStatuses', () => {
    it('returns empty array when no workers initialized', () => {
      const statuses = getAllWorkerStatuses();
      expect(statuses).toEqual([]);
    });

    it('returns all worker statuses', () => {
      initWorkerStatus('Worker1');
      initWorkerStatus('Worker2');
      initWorkerStatus('Worker3');

      const statuses = getAllWorkerStatuses();

      expect(statuses).toHaveLength(3);
      expect(statuses.map(s => s.name).sort()).toEqual(['Worker1', 'Worker2', 'Worker3']);
    });

    it('returns copies, not references', () => {
      initWorkerStatus('TestWorker');

      const statuses = getAllWorkerStatuses();

      // Arrays should be different references
      expect(statuses).not.toBe(getAllWorkerStatuses());
    });
  });

  describe('getWorkerStatus', () => {
    it('returns undefined for non-existent worker', () => {
      const status = getWorkerStatus('NonExistent');
      expect(status).toBeUndefined();
    });

    it('returns status for existing worker', () => {
      initWorkerStatus('TestWorker');
      updateWorkerState('TestWorker', 'running');

      const status = getWorkerStatus('TestWorker');

      expect(status).toBeDefined();
      expect(status?.name).toBe('TestWorker');
      expect(status?.state).toBe('running');
    });
  });

  describe('global state persistence', () => {
    it('persists state across multiple module accesses', () => {
      initWorkerStatus('SharedWorker');
      updateWorkerRun('SharedWorker', 100);

      // Simulate another module accessing the same state
      const statuses = getAllWorkerStatuses();
      const sharedWorker = statuses.find(s => s.name === 'SharedWorker');

      expect(sharedWorker?.itemsProcessed).toBe(100);
    });
  });
});
