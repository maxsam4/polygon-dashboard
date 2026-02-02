/**
 * Chart series configuration for different metrics.
 * Centralized to reduce code duplication in chart components.
 */

import { CHART_COLOR_PALETTE } from './constants';

export type ChartMetric =
  | 'gas'
  | 'finality'
  | 'mgas'
  | 'tps'
  | 'totalBaseFee'
  | 'totalPriorityFee'
  | 'totalFee'
  | 'blockLimit'
  | 'blockLimitUtilization'
  | 'borBlockTime'
  | 'heimdallBlockTime';

export interface SeriesOption {
  key: string;
  label: string;
  enabled: boolean;
  color: string;
}

/**
 * Get the initial series options for a given metric.
 * @param metric - The chart metric type
 * @param showCumulative - Whether to show cumulative series for fee metrics
 * @returns Array of series options
 */
export function getSeriesOptionsForMetric(
  metric: ChartMetric,
  showCumulative = false
): SeriesOption[] {
  const colors = CHART_COLOR_PALETTE;

  switch (metric) {
    case 'gas':
      return [
        { key: 'base', label: 'Base', enabled: true, color: colors[0] },
        { key: 'medianPriority', label: 'Median Priority', enabled: true, color: colors[1] },
        { key: 'minPriority', label: 'Min Priority', enabled: false, color: colors[2] },
        { key: 'maxPriority', label: 'Max Priority', enabled: false, color: colors[3] },
        { key: 'total', label: 'Total', enabled: false, color: colors[4] },
      ];

    case 'totalBaseFee':
    case 'totalPriorityFee':
    case 'totalFee':
      if (showCumulative) {
        return [
          { key: 'cumulative', label: 'Cumulative', enabled: true, color: colors[0] },
          { key: 'perBucket', label: 'Per Period', enabled: false, color: colors[1] },
        ];
      }
      return [
        { key: 'perBucket', label: 'Per Period', enabled: true, color: colors[0] },
      ];

    case 'blockLimit':
      return [
        { key: 'value', label: 'Block Limit', enabled: true, color: colors[0] },
      ];

    case 'blockLimitUtilization':
      return [
        { key: 'value', label: 'Utilization %', enabled: true, color: colors[0] },
      ];

    case 'mgas':
      return [
        { key: 'value', label: 'MGAS/s', enabled: true, color: colors[0] },
      ];

    case 'tps':
      return [
        { key: 'value', label: 'TPS', enabled: true, color: colors[0] },
      ];

    case 'borBlockTime':
    case 'heimdallBlockTime':
      return [
        { key: 'avg', label: 'Avg', enabled: true, color: colors[0] },
        { key: 'min', label: 'Min', enabled: false, color: colors[1] },
        { key: 'max', label: 'Max', enabled: false, color: colors[2] },
      ];

    case 'finality':
    default:
      return [
        { key: 'avg', label: 'Avg', enabled: true, color: colors[0] },
        { key: 'min', label: 'Min', enabled: false, color: colors[1] },
        { key: 'max', label: 'Max', enabled: false, color: colors[2] },
      ];
  }
}

/**
 * Get the API endpoint for a given metric.
 * @param metric - The chart metric type
 * @returns API endpoint path
 */
export function getApiEndpointForMetric(metric: ChartMetric): string {
  return metric === 'heimdallBlockTime'
    ? '/api/milestone-chart-data'
    : '/api/chart-data';
}

/**
 * Get block range info from a data point for tooltip display.
 * @param metric - The chart metric type
 * @param dataPoint - The data point to extract info from
 * @returns Block range display and copy value, or undefined if not applicable
 */
export function getBlockRangeInfo(
  metric: ChartMetric,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataPoint: any
): { display: string; copyValue: string } | undefined {
  if (metric === 'borBlockTime' && dataPoint.blockStart !== undefined && dataPoint.blockEnd !== undefined) {
    const start = dataPoint.blockStart;
    const end = dataPoint.blockEnd;
    if (start === end) {
      return {
        display: `Block ${start.toLocaleString()}`,
        copyValue: String(start),
      };
    }
    return {
      display: `Blocks ${start.toLocaleString()} - ${end.toLocaleString()}`,
      copyValue: `${start}-${end}`,
    };
  } else if (metric === 'heimdallBlockTime' && dataPoint.milestoneId !== undefined) {
    return {
      display: `Milestone #${dataPoint.milestoneId.toLocaleString()}`,
      copyValue: String(dataPoint.milestoneId),
    };
  }
  return undefined;
}
