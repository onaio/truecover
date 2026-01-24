// ABOUTME: Compact horizontal stats bar showing key metrics for map mode
// ABOUTME: Displays locations, pixels, rounds, visit progress in a single row

import React from 'react';

interface CondensedStatsBarProps {
  locationTotalCount: number;
  pixelTotalCount: number;
  roundCount: number;
  locationsToVisitCount: number;
  locationsToVisitPercent: number;
  locationsVisitedCount: number;
  locationsVisitedPercent: number;
}

const CondensedStatsBar: React.FC<CondensedStatsBarProps> = ({
  locationTotalCount,
  pixelTotalCount,
  roundCount,
  locationsToVisitCount,
  locationsToVisitPercent,
  locationsVisitedCount,
  locationsVisitedPercent,
}) => {
  return (
    <div className="h-9 flex items-center bg-tactical-bg-secondary border-b border-tactical-border-medium">
      <div className="flex items-center gap-2 px-4">
        <span className="text-tactical-text-dim text-xs uppercase tracking-wider">Locations:</span>
        <span className="text-tactical-text-primary font-bold text-sm font-mono">
          {locationTotalCount.toLocaleString()}
        </span>
      </div>

      <div className="border-l border-tactical-border-dark h-full" />

      <div className="flex items-center gap-2 px-4">
        <span className="text-tactical-text-dim text-xs uppercase tracking-wider">Pixels:</span>
        <span className="text-tactical-text-primary font-bold text-sm font-mono">
          {pixelTotalCount.toLocaleString()}
        </span>
      </div>

      <div className="border-l border-tactical-border-dark h-full" />

      <div className="flex items-center gap-2 px-4">
        <span className="text-tactical-text-dim text-xs uppercase tracking-wider">Rounds:</span>
        <span className="text-tactical-text-primary font-bold text-sm font-mono">
          {roundCount.toLocaleString()}
        </span>
      </div>

      <div className="border-l border-tactical-border-dark h-full" />

      <div className="flex items-center gap-2 px-4">
        <span className="text-tactical-text-dim text-xs uppercase tracking-wider">To Visit:</span>
        <span className="text-tactical-text-primary font-bold text-sm font-mono">
          {locationsToVisitCount.toLocaleString()}
          <span className="text-tactical-text-dim ml-1">({locationsToVisitPercent}%)</span>
        </span>
      </div>

      <div className="border-l border-tactical-border-dark h-full" />

      <div className="flex items-center gap-2 px-4">
        <span className="text-tactical-text-dim text-xs uppercase tracking-wider">Visited:</span>
        <span className="text-tactical-text-primary font-bold text-sm font-mono">
          {locationsVisitedCount.toLocaleString()}
          <span className="text-tactical-text-dim ml-1">({locationsVisitedPercent}%)</span>
        </span>
      </div>
    </div>
  );
};

export default CondensedStatsBar;
