// ABOUTME: Histogram visualization showing distribution of locations across equal-width bins
// ABOUTME: Uses Observable Plot for rendering, styled with tactical theme

import React, { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import { calculateJenksBreaks, PREVALENCE_COLORS, UNCERTAINTY_COLORS } from '../utils/jenksBreaks';
import BCIExplanationModal from './BCIExplanationModal';

interface DistributionHistogramProps {
  data: any[];
  mode: 'coverage' | 'uncertainty';
  visible: boolean;
  indicatorName?: string;
  onBrushChange?: (ranges: [number, number][] | null) => void;
  dataType?: 'locations' | 'pixels';
}

const DistributionHistogram: React.FC<DistributionHistogramProps> = ({ data, mode, visible, indicatorName, onBrushChange, dataType = 'locations' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [numBins, setNumBins] = useState<number>(12);
  const [showColors, setShowColors] = useState<boolean>(true);
  const [selectedRanges, setSelectedRanges] = useState<[number, number][]>([]);
  const [meanBCI, setMeanBCI] = useState<number | null>(null);
  const [confidenceLevel, setConfidenceLevel] = useState<string | null>(null);
  const [isBCIModalOpen, setIsBCIModalOpen] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !visible || !data || data.length === 0) {
      return;
    }

    // Extract values based on mode
    const values: number[] = [];
    const property = mode === 'coverage' ? 'prevalence_prediction' : 'prevalence_bci_width';

    data.forEach(record => {
      const value = record[property];
      if (typeof value === 'number' && !isNaN(value)) {
        values.push(value);
      }
    });

    if (values.length === 0) {
      return;
    }

    // Calculate mean BCI and confidence level (for uncertainty mode)
    if (mode === 'uncertainty') {
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      setMeanBCI(mean);

      if (mean <= 0.05) {
        setConfidenceLevel('Very High');
      } else if (mean <= 0.10) {
        setConfidenceLevel('High');
      } else if (mean <= 0.20) {
        setConfidenceLevel('Moderate');
      } else {
        setConfidenceLevel('Low');
      }
    } else {
      setMeanBCI(null);
      setConfidenceLevel(null);
    }

    // Calculate equal-width bins
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / numBins;

    // Calculate Jenks breaks for coloring
    const colorPalette = mode === 'coverage' ? PREVALENCE_COLORS : UNCERTAINTY_COLORS;
    const jenksBreaks = showColors ? calculateJenksBreaks(values, colorPalette.length) : [];

    // Helper function to get color for a bin based on Jenks breaks
    const getBinColor = (binMin: number, binMax: number): string => {
      if (!showColors || jenksBreaks.length === 0) return '#ffffff';

      // Find which Jenks class has the most overlap with this bin
      const binMid = (binMin + binMax) / 2;

      // Handle bins below first break - use first color
      if (binMid < jenksBreaks[0]) {
        return colorPalette[0];
      }

      // Find which Jenks break interval contains the bin midpoint
      for (let i = 0; i < jenksBreaks.length - 1; i++) {
        if (binMid >= jenksBreaks[i] && binMid < jenksBreaks[i + 1]) {
          return colorPalette[i] || '#ffffff';
        }
      }
      // If at or beyond the last break
      return colorPalette[colorPalette.length - 1] || '#ffffff';
    };

    // Create bins
    const bins: { x0: number; x1: number; count: number; color: string }[] = [];
    const boundaries: number[] = [];

    for (let i = 0; i <= numBins; i++) {
      boundaries.push(min + i * binWidth);
    }

    for (let i = 0; i < numBins; i++) {
      const x0 = boundaries[i];
      const x1 = boundaries[i + 1];
      const count = values.filter(v => v >= x0 && (i === numBins - 1 ? v <= x1 : v < x1)).length;
      const color = getBinColor(x0, x1);

      bins.push({ x0, x1, count, color });
    }

    // Calculate max count for positioning labels at top
    const maxCount = Math.max(...bins.map(b => b.count));

    // Create the plot
    const plot = Plot.plot({
      width: containerRef.current.clientWidth,
      height: 200,
      marginLeft: 50,
      marginRight: 20,
      marginTop: 20,
      marginBottom: 60,
      insetLeft: 1,
      style: {
        background: '#0a0a0a',
        color: '#ffffff',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      },
      x: {
        label: mode === 'coverage' ? 'Prevalence' : 'Uncertainty (BCI Width)',
        labelAnchor: 'center',
        tickFormat: d => d.toFixed(3),
        grid: true,
        line: true,
        domain: [min, max],
        ticks: boundaries
      },
      y: {
        label: dataType === 'pixels' ? 'Number of Pixels' : 'Number of Locations',
        labelAnchor: 'center',
        grid: true,
        line: true
      },
      marks: [
        Plot.rectY(bins, {
          x1: 'x0',
          x2: 'x1',
          y: 'count',
          fill: 'color',
          stroke: '#333333',
          strokeWidth: 1
        }),
        Plot.ruleY([0]),
        // Add reference lines for uncertainty mode
        ...(mode === 'uncertainty' ? [
          // Reference lines at key BCI width thresholds
          Plot.ruleX([0.05, 0.10, 0.20, 0.30], {
            stroke: '#ffffff',
            strokeWidth: 1,
            strokeDasharray: '4,4',
            opacity: 0.5
          }),
          // Text labels for reference lines (confidence levels)
          // Only show labels for lines that are within the data range and not overlapping Y-axis
          Plot.text([
            { x: 0.05, label: 'Very High', y: maxCount },
            { x: 0.10, label: 'High', y: maxCount },
            { x: 0.20, label: 'Moderate', y: maxCount },
            { x: 0.30, label: 'Low', y: maxCount }
          ].filter(d => d.x >= min && d.x <= max), {
            x: 'x',
            y: 'y',
            text: 'label',
            dx: 3,
            dy: -5,
            fill: '#ffffff',
            fontSize: 10,
            textAnchor: 'start',
            lineAnchor: 'top',
            fontWeight: 'bold'
          })
        ] : [])
      ]
    });

    // Clear previous content and append new plot
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(plot);

    // Add custom tooltip and click handlers
    const rects = plot.querySelectorAll('rect');
    rects.forEach((rect, index) => {
      if (index < bins.length) {
        const bin = bins[index];

        // Check if this bin is in the selected ranges
        const isSelected = selectedRanges.some(range =>
          bin.x0 === range[0] && bin.x1 === range[1]
        );

        // Add visual indicator for selected bins
        if (isSelected) {
          (rect as SVGRectElement).style.strokeWidth = '3';
          (rect as SVGRectElement).style.stroke = showColors ? '#ffffff' : '#ff6600';
        }

        // Add cursor pointer to indicate clickability
        (rect as SVGRectElement).style.cursor = 'pointer';

        rect.addEventListener('mouseenter', (e: MouseEvent) => {
          if (tooltipRef.current) {
            const action = isSelected ? 'click to unselect' : 'click to select';
            const itemType = dataType === 'pixels' ? 'pixels' : 'locations';
            tooltipRef.current.innerHTML = `${bin.x0.toFixed(3)} - ${bin.x1.toFixed(3)}<br/>${bin.count} ${itemType}<br/><i>(${action})</i>`;
            tooltipRef.current.style.display = 'block';
            tooltipRef.current.style.left = `${e.clientX + 10}px`;
            tooltipRef.current.style.top = `${e.clientY + 10}px`;
          }
        });
        rect.addEventListener('mousemove', (e: MouseEvent) => {
          if (tooltipRef.current) {
            tooltipRef.current.style.left = `${e.clientX + 10}px`;
            tooltipRef.current.style.top = `${e.clientY + 10}px`;
          }
        });
        rect.addEventListener('mouseleave', () => {
          if (tooltipRef.current) {
            tooltipRef.current.style.display = 'none';
          }
        });
        rect.addEventListener('click', () => {
          const range: [number, number] = [bin.x0, bin.x1];

          // Toggle selection
          setSelectedRanges(prev => {
            const isCurrentlySelected = prev.some(r => r[0] === range[0] && r[1] === range[1]);
            let newRanges: [number, number][];

            if (isCurrentlySelected) {
              // Remove from selection
              newRanges = prev.filter(r => !(r[0] === range[0] && r[1] === range[1]));
            } else {
              // Add to selection
              newRanges = [...prev, range];
            }

            // Notify parent
            if (onBrushChange) {
              onBrushChange(newRanges.length > 0 ? newRanges : null);
            }

            return newRanges;
          });
        });
      }
    });

    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [data, mode, visible, numBins, showColors, selectedRanges, dataType]);

  if (!visible) {
    return null;
  }

  return (
    <div className="border border-tactical-border-medium bg-tactical-bg-secondary p-4 mb-6">
      <div className="mb-3 flex justify-between items-start">
        <div>
          <h3 className="font-mono font-bold text-tactical-text-primary uppercase tracking-wider text-sm">
            {mode === 'coverage' ? 'Prevalence Prediction' : 'Uncertainty'} {indicatorName ? `- ${indicatorName}` : ''}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'uncertainty' && meanBCI !== null && confidenceLevel && (
            <div className="flex items-center gap-1 text-xs font-mono text-tactical-text-primary">
              <span>
                Mean BCI: <span className="font-bold">{meanBCI.toFixed(3)}</span> ({confidenceLevel})
              </span>
              <button
                onClick={() => setIsBCIModalOpen(true)}
                className="w-4 h-4 rounded-full border border-tactical-text-dim text-tactical-text-dim hover:border-tactical-text-primary hover:text-tactical-text-primary transition-colors flex items-center justify-center cursor-pointer"
                title="Explain BCI Width"
              >
                <span className="text-[10px] font-bold">i</span>
              </button>
            </div>
          )}
          {selectedRanges.length > 0 && (
            <button
              onClick={() => {
                setSelectedRanges([]);
                if (onBrushChange) {
                  onBrushChange(null);
                }
              }}
              className="px-2 py-1 text-xs font-mono bg-tactical-accent-orange border border-tactical-accent-orange text-tactical-bg-primary cursor-pointer focus:outline-none hover:bg-tactical-bg-primary hover:text-tactical-accent-orange transition-colors"
            >
              Clear Filter ({selectedRanges.length})
            </button>
          )}
          <button
            onClick={() => setShowColors(!showColors)}
            className="px-2 py-1 text-xs font-mono bg-tactical-bg-primary border border-tactical-border-medium text-tactical-text-primary cursor-pointer focus:outline-none focus:border-tactical-accent-orange"
          >
            {showColors ? 'Colors: On' : 'Colors: Off'}
          </button>
          <label className="text-xs text-tactical-text-dim font-mono">Bins:</label>
          <select
            value={numBins}
            onChange={(e) => setNumBins(Number(e.target.value))}
            className="px-2 py-1 text-xs font-mono bg-tactical-bg-primary border border-tactical-border-medium text-tactical-text-primary cursor-pointer focus:outline-none focus:border-tactical-accent-orange"
          >
            <option value={12}>12</option>
            <option value={24}>24</option>
          </select>
        </div>
      </div>
      <div ref={containerRef} className="w-full"></div>
      <div
        ref={tooltipRef}
        style={{
          display: 'none',
          position: 'fixed',
          backgroundColor: '#000000',
          color: '#ffffff',
          padding: '8px',
          border: '1px solid #ffffff',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '12px',
          pointerEvents: 'none',
          zIndex: 1000,
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)'
        }}
      ></div>

      <BCIExplanationModal
        isOpen={isBCIModalOpen}
        onClose={() => setIsBCIModalOpen(false)}
        data={data}
        indicatorName={indicatorName}
        numBins={numBins}
      />
    </div>
  );
};

export default DistributionHistogram;
