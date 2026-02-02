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
        className="absolute pointer-events-none z-10 glass-tooltip rounded px-3 py-2 text-sm transition-colors duration-200"
        style={{
          left: position.x,
          top: position.y,
          minWidth: '180px',
        }}
      >
        <div className="font-medium text-foreground mb-1">
          {content.time}
        </div>
        {content.blockRange && (
          <div className="text-xs text-muted mb-1">
            {content.blockRange}
            <span className="ml-1 text-accent">(click to copy)</span>
          </div>
        )}
        {content.values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full ring-1 ring-white/20"
              style={{ backgroundColor: v.color }}
            />
            <span className="text-muted">{v.label}:</span>
            <span className="font-medium text-foreground">{v.value}</span>
          </div>
        ))}
      </div>
    );
  }
);
