// Tests for heimdall.ts - Heimdall client with endpoint rotation

import { HeimdallClient, HeimdallExhaustedError } from '../heimdall';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock utils
jest.mock('../utils', () => ({
  sleep: jest.fn(() => Promise.resolve()),
}));

import { sleep } from '../utils';

const mockSleep = sleep as jest.Mock;

describe('HeimdallClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('throws error when no URLs provided', () => {
      expect(() => new HeimdallClient([])).toThrow('At least one Heimdall API URL is required');
    });

    it('returns endpoint count', () => {
      const client = new HeimdallClient(['https://heimdall1.test', 'https://heimdall2.test']);
      expect(client.endpointCount).toBe(2);
    });
  });

  describe('getLatestMilestone', () => {
    it('fetches latest milestone and count', async () => {
      const client = new HeimdallClient(['https://heimdall.test']);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: '100000' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            milestone: {
              milestone_id: '50000100',
              start_block: '50000001',
              end_block: '50000100',
              hash: '0xhash',
              proposer: '0xproposer',
              bor_chain_id: '137',
              timestamp: '1705320030',
            },
          }),
        });

      const result = await client.getLatestMilestone();

      expect(mockFetch).toHaveBeenCalledWith('https://heimdall.test/milestones/count');
      expect(mockFetch).toHaveBeenCalledWith('https://heimdall.test/milestones/latest');
      expect(result.sequenceId).toBe(100000);
      expect(result.milestoneId).toBe(50000100n);
      expect(result.startBlock).toBe(50000001n);
      expect(result.endBlock).toBe(50000100n);
    });
  });

  describe('getMilestone', () => {
    it('fetches milestone by sequence ID', async () => {
      const client = new HeimdallClient(['https://heimdall.test']);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          milestone: {
            milestone_id: '49000099',
            start_block: '49000000',
            end_block: '49000099',
            hash: '0xhash',
            proposer: '0xproposer',
            bor_chain_id: '137',
            timestamp: '1705300000',
          },
        }),
      });

      const result = await client.getMilestone(99000);

      expect(mockFetch).toHaveBeenCalledWith('https://heimdall.test/milestones/99000');
      expect(result.sequenceId).toBe(99000);
    });

    it('converts timestamp to Date', async () => {
      const client = new HeimdallClient(['https://heimdall.test']);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          milestone: {
            milestone_id: '100',
            start_block: '1',
            end_block: '100',
            hash: '0xhash',
            proposer: '0xproposer',
            bor_chain_id: '137',
            timestamp: '1705320030', // 2024-01-15T12:00:30Z
          },
        }),
      });

      const result = await client.getMilestone(1);

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.timestamp.getTime()).toBe(1705320030 * 1000);
    });

    it('handles null proposer', async () => {
      const client = new HeimdallClient(['https://heimdall.test']);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          milestone: {
            milestone_id: '100',
            start_block: '1',
            end_block: '100',
            hash: '0xhash',
            proposer: '',
            bor_chain_id: '137',
            timestamp: '1705320030',
          },
        }),
      });

      const result = await client.getMilestone(1);

      expect(result.proposer).toBeNull();
    });
  });

  describe('getMilestones', () => {
    it('fetches multiple milestones in parallel', async () => {
      const client = new HeimdallClient(['https://heimdall.test']);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            milestone: {
              milestone_id: '100',
              start_block: '1',
              end_block: '100',
              hash: '0xhash1',
              proposer: '0xp1',
              bor_chain_id: '137',
              timestamp: '1705300000',
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            milestone: {
              milestone_id: '200',
              start_block: '101',
              end_block: '200',
              hash: '0xhash2',
              proposer: '0xp2',
              bor_chain_id: '137',
              timestamp: '1705300100',
            },
          }),
        });

      const results = await client.getMilestones([1, 2]);

      expect(results).toHaveLength(2);
      expect(results[0].milestoneId).toBe(100n);
      expect(results[1].milestoneId).toBe(200n);
    });

    it('skips failed milestone fetches', async () => {
      const client = new HeimdallClient(['https://heimdall.test'], {
        maxRetries: 0,
        delayMs: 0,
      });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            milestone: {
              milestone_id: '100',
              start_block: '1',
              end_block: '100',
              hash: '0xhash1',
              proposer: '0xp1',
              bor_chain_id: '137',
              timestamp: '1705300000',
            },
          }),
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const results = await client.getMilestones([1, 2]);

      expect(results).toHaveLength(1);
      expect(results[0].sequenceId).toBe(1);
    });
  });

  describe('getMilestoneCount', () => {
    it('returns current milestone count', async () => {
      const client = new HeimdallClient(['https://heimdall.test']);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ count: '100000' }),
      });

      const result = await client.getMilestoneCount();

      expect(mockFetch).toHaveBeenCalledWith('https://heimdall.test/milestones/count');
      expect(result).toBe(100000);
    });
  });

  describe('endpoint rotation', () => {
    it('rotates to next endpoint on failure', async () => {
      const client = new HeimdallClient([
        'https://heimdall1.test',
        'https://heimdall2.test',
      ]);

      mockFetch
        .mockRejectedValueOnce(new Error('First endpoint down'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: '100' }),
        });

      const result = await client.getMilestoneCount();

      expect(result).toBe(100);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toBe('https://heimdall1.test/milestones/count');
      expect(mockFetch.mock.calls[1][0]).toBe('https://heimdall2.test/milestones/count');
    });

    it('handles HTTP errors', async () => {
      const client = new HeimdallClient(['https://heimdall1.test', 'https://heimdall2.test']);

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: '100' }),
        });

      const result = await client.getMilestoneCount();

      expect(result).toBe(100);
    });
  });

  describe('retry logic', () => {
    it('retries up to maxRetries times', async () => {
      const client = new HeimdallClient(['https://heimdall.test'], {
        maxRetries: 2,
        delayMs: 100,
      });

      mockFetch
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ count: '100' }),
        });

      const result = await client.getMilestoneCount();

      expect(result).toBe(100);
      expect(mockSleep).toHaveBeenCalledTimes(2);
      expect(mockSleep).toHaveBeenCalledWith(100);
    });

    it('throws HeimdallExhaustedError after all retries fail', async () => {
      const client = new HeimdallClient(['https://heimdall.test'], {
        maxRetries: 1,
        delayMs: 0,
      });

      mockFetch.mockRejectedValue(new Error('Always fails'));

      await expect(client.getMilestoneCount()).rejects.toThrow(HeimdallExhaustedError);
    });

    it('includes last error in HeimdallExhaustedError', async () => {
      const client = new HeimdallClient(['https://heimdall.test'], {
        maxRetries: 0,
        delayMs: 0,
      });

      const originalError = new Error('Original error');
      mockFetch.mockRejectedValue(originalError);

      try {
        await client.getMilestoneCount();
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HeimdallExhaustedError);
        expect((e as HeimdallExhaustedError).lastError).toBe(originalError);
      }
    });
  });
});

describe('HeimdallExhaustedError', () => {
  it('has correct name', () => {
    const error = new HeimdallExhaustedError('Test message');
    expect(error.name).toBe('HeimdallExhaustedError');
  });

  it('stores last error', () => {
    const lastError = new Error('Last error');
    const error = new HeimdallExhaustedError('Test message', lastError);
    expect(error.lastError).toBe(lastError);
  });
});
