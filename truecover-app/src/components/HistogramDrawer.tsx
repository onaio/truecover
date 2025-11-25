// ABOUTME: Bottom drawer component for showing distribution histogram in map mode
// ABOUTME: Slides up/down with smooth transition, contains tabs and histogram

import React from 'react';
import DistributionHistogram from './DistributionHistogram';

interface HistogramData {
  bins: Array<{
    bucket: number;
    count: number;
    min: number | null;
    max: number | null;
  }>;
  overall_min: number | null;
  overall_max: number | null;
  num_bins: number;
  mode: string;
  data_type: string;
}

interface HistogramDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  histogramData?: HistogramData;
  interpolationMode: 'coverage' | 'uncertainty' | 'metadata';
  indicatorName?: string;
  onBrushChange?: (ranges: [number, number][] | null) => void;
  histogramTab: 'locations' | 'pixels';
  onTabChange: (tab: 'locations' | 'pixels') => void;
  locationTotalCount: number;
  pixelTotalCount: number;
}

const HistogramDrawer: React.FC<HistogramDrawerProps> = ({
  isOpen,
  onToggle,
  histogramData,
  interpolationMode,
  indicatorName,
  onBrushChange,
  histogramTab,
  onTabChange,
  locationTotalCount,
  pixelTotalCount,
}) => {
  const histogramMode = interpolationMode === 'coverage' ? 'coverage' : 'uncertainty';

  return (
    <div
      className={`
        absolute bottom-0 left-0 right-0
        bg-tactical-bg-primary border-t border-tactical-border-medium
        transform transition-transform duration-300 ease-out
        ${isOpen ? 'translate-y-0' : 'translate-y-[calc(100%-40px)]'}
      `}
      style={{ height: '330px' }}
    >
      {/* Handle */}
      <button
        onClick={onToggle}
        className="w-full h-10 flex items-center justify-center gap-2
                   bg-tactical-bg-secondary border-b border-tactical-border-dark
                   hover:bg-tactical-bg-tertiary cursor-pointer transition-colors"
      >
        <span className="text-xs uppercase text-tactical-text-dim font-mono tracking-wider">
          Distribution
        </span>
        <svg
          className={`w-4 h-4 text-tactical-text-dim transform transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      {/* Content */}
      <div className="p-4 overflow-hidden">
        {/* Tab Switcher */}
        <div className="flex gap-2 mb-0 border-b border-tactical-border-medium bg-tactical-bg-secondary -mx-4 px-4">
          <button
            className={`px-4 py-2 font-medium transition-colors ${
              histogramTab === 'locations'
                ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                : 'text-tactical-text-dim hover:text-tactical-text-secondary'
            }`}
            onClick={() => onTabChange('locations')}
          >
            Locations ({locationTotalCount.toLocaleString()})
          </button>
          <button
            className={`px-4 py-2 font-medium transition-colors ${
              histogramTab === 'pixels'
                ? 'text-tactical-accent-green border-b-2 border-tactical-accent-green'
                : 'text-tactical-text-dim hover:text-tactical-text-secondary'
            }`}
            onClick={() => onTabChange('pixels')}
          >
            Pixels ({pixelTotalCount.toLocaleString()})
          </button>
        </div>

        {/* Histogram */}
        <div className="-mx-4 -mb-4">
          <DistributionHistogram
            histogramData={histogramData}
            mode={histogramMode}
            visible={true}
            indicatorName={indicatorName}
            onBrushChange={onBrushChange}
            dataType={histogramTab}
          />
        </div>
      </div>
    </div>
  );
};

export default HistogramDrawer;
