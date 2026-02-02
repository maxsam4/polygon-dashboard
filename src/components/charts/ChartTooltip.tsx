'use client';

import { forwardRef } from 'react';

export interface TooltipValue {
  label: string;
  value: string;
  color: string;
}

export interface TooltipContent {
  time: string;
  blockRange?: string;
  values: TooltipValue[];
}

interface ChartTooltipProps {
  visible: boolean;
  content: TooltipContent | null;
  position: { x: number; y: number };
}

/**
 * Chart tooltip component for displaying data point information.
 * Supports copy-to-clipboard functionality for block ranges.
 */
export const ChartTooltip = forwardRef<HTMLDivElement, ChartTooltipProps>(
  function ChartTooltip({ visible, content, position }, ref) {
    if (!visible || !content) {
      return null;
    }

    return (
      <div
        ref={ref}
        className="absolute pointer-events-none z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-sm transition-colors duration-200"
        style={{
          left: position.x,
          top: position.y,
          minWidth: '180px',
        }}
      >
        <div className="font-medium text-gray-900 dark:text-gray-100 mb-1">
          {content.time}
        </div>
        {content.blockRange && (
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
            {content.blockRange}
            <span className="ml-1 text-blue-500 dark:text-blue-400">(click to copy)</span>
          </div>
        )}
        {content.values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: v.color }}
            />
            <span className="text-gray-600 dark:text-gray-300">{v.label}:</span>
            <span className="font-medium text-gray-900 dark:text-gray-100">{v.value}</span>
          </div>
        ))}
      </div>
    );
  }
);
