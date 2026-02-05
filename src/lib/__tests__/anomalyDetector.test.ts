// Tests for anomalyDetector.ts - groupConsecutiveAnomalies function

import { groupConsecutiveAnomalies } from '../anomalyDetector';

// Helper type matching BlockAnomalyResult
interface TestAnomalyResult {
  blockNumber: bigint;
  timestamp: Date;
  metricType: 'gas_price' | 'block_time' | 'finality' | 'tps' | 'mgas' | 'reorg';
  severity: 'warning' | 'critical';
  value: number;
  threshold: number;
}

function createAnomaly(
  blockNumber: number,
  metricType: TestAnomalyResult['metricType'] = 'gas_price',
  severity: TestAnomalyResult['severity'] = 'warning'
): TestAnomalyResult {
  return {
    blockNumber: BigInt(blockNumber),
    timestamp: new Date('2024-01-15T12:00:00Z'),
    metricType,
    severity,
    value: 100,
    threshold: 50,
  };
}

describe('groupConsecutiveAnomalies', () => {
  it('returns empty array for empty input', () => {
    expect(groupConsecutiveAnomalies([])).toEqual([]);
  });

  it('groups single anomaly into one group', () => {
    const anomalies = [createAnomaly(100)];
    const groups = groupConsecutiveAnomalies(anomalies);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(1);
    expect(groups[0][0].blockNumber).toBe(100n);
  });

  it('groups consecutive blocks with same metric and severity', () => {
    const anomalies = [
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(101, 'gas_price', 'warning'),
      createAnomaly(102, 'gas_price', 'warning'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
    expect(groups[0][0].blockNumber).toBe(100n);
    expect(groups[0][2].blockNumber).toBe(102n);
  });

  it('splits groups on non-consecutive blocks', () => {
    const anomalies = [
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(101, 'gas_price', 'warning'),
      // Gap: block 102 missing
      createAnomaly(103, 'gas_price', 'warning'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0].blockNumber).toBe(100n);
    expect(groups[0][1].blockNumber).toBe(101n);
    expect(groups[1]).toHaveLength(1);
    expect(groups[1][0].blockNumber).toBe(103n);
  });

  it('splits groups on different severities', () => {
    const anomalies = [
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(101, 'gas_price', 'critical'), // Different severity
      createAnomaly(102, 'gas_price', 'warning'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(1);
    expect(groups[0][0].severity).toBe('critical'); // Sorted by severity
    expect(groups[1]).toHaveLength(1);
    expect(groups[2]).toHaveLength(1);
  });

  it('splits groups on different metric types', () => {
    const anomalies = [
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(101, 'block_time', 'warning'), // Different metric
      createAnomaly(102, 'gas_price', 'warning'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    expect(groups).toHaveLength(3);
    // Sorted by metricType, then blockNumber
  });

  it('handles multiple metrics on same block', () => {
    const anomalies = [
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(100, 'block_time', 'warning'),
      createAnomaly(101, 'gas_price', 'warning'),
      createAnomaly(101, 'block_time', 'warning'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    // Should have 2 groups: gas_price 100-101, block_time 100-101
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(2);
    expect(groups[1]).toHaveLength(2);
  });

  it('handles unsorted input correctly', () => {
    const anomalies = [
      createAnomaly(103, 'gas_price', 'warning'),
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(102, 'gas_price', 'warning'),
      createAnomaly(101, 'gas_price', 'warning'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    // Should be sorted and grouped as one consecutive range
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
    expect(groups[0][0].blockNumber).toBe(100n);
    expect(groups[0][3].blockNumber).toBe(103n);
  });

  it('complex scenario: gaps, different metrics, different severities', () => {
    const anomalies = [
      // Gas price warning: blocks 100, 101, 102 (consecutive)
      createAnomaly(100, 'gas_price', 'warning'),
      createAnomaly(101, 'gas_price', 'warning'),
      createAnomaly(102, 'gas_price', 'warning'),
      // Gas price warning: block 105 (gap from 102)
      createAnomaly(105, 'gas_price', 'warning'),
      // Block time warning: blocks 100, 101 (different metric)
      createAnomaly(100, 'block_time', 'warning'),
      createAnomaly(101, 'block_time', 'warning'),
      // Gas price critical: block 101 (different severity)
      createAnomaly(101, 'gas_price', 'critical'),
    ];
    const groups = groupConsecutiveAnomalies(anomalies);

    // Expected groups (sorted by metricType, severity, blockNumber):
    // 1. block_time warning: 100-101 (2 blocks)
    // 2. gas_price critical: 101 (1 block)
    // 3. gas_price warning: 100-102 (3 blocks)
    // 4. gas_price warning: 105 (1 block, gap)
    expect(groups).toHaveLength(4);

    // Verify block_time warning group
    const blockTimeGroup = groups.find(g => g[0].metricType === 'block_time');
    expect(blockTimeGroup).toHaveLength(2);

    // Verify gas_price critical group
    const gasCriticalGroup = groups.find(
      g => g[0].metricType === 'gas_price' && g[0].severity === 'critical'
    );
    expect(gasCriticalGroup).toHaveLength(1);

    // Verify gas_price warning groups (there should be 2)
    const gasWarningGroups = groups.filter(
      g => g[0].metricType === 'gas_price' && g[0].severity === 'warning'
    );
    expect(gasWarningGroups).toHaveLength(2);
    // One with 3 blocks (100-102), one with 1 block (105)
    expect(gasWarningGroups.some(g => g.length === 3)).toBe(true);
    expect(gasWarningGroups.some(g => g.length === 1)).toBe(true);
  });
});
