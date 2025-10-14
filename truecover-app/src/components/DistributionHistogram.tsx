// ABOUTME: Histogram visualization showing distribution of locations across equal-width bins
// ABOUTME: Uses Observable Plot for rendering, styled with tactical theme

import React, { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';

interface DistributionHistogramProps {
  data: any[];
  mode: 'coverage' | 'uncertainty';
  visible: boolean;
  indicatorName?: string;
}

const DistributionHistogram: React.FC<DistributionHistogramProps> = ({ data, mode, visible, indicatorName }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numBins, setNumBins] = useState<number>(12);

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

    // Calculate equal-width bins
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / numBins;

    // Create bins
    const bins: { x0: number; x1: number; count: number }[] = [];
    const boundaries: number[] = [];

    for (let i = 0; i <= numBins; i++) {
      boundaries.push(min + i * binWidth);
    }

    for (let i = 0; i < numBins; i++) {
      const x0 = boundaries[i];
      const x1 = boundaries[i + 1];
      const count = values.filter(v => v >= x0 && (i === numBins - 1 ? v <= x1 : v < x1)).length;

      bins.push({ x0, x1, count });
    }

    // Create the plot
    const plot = Plot.plot({
      width: containerRef.current.clientWidth,
      height: 200,
      marginLeft: 50,
      marginRight: 20,
      marginTop: 20,
      marginBottom: 60,
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
        label: 'Number of Locations',
        labelAnchor: 'center',
        grid: true,
        line: true
      },
      marks: [
        Plot.rectY(bins, {
          x1: 'x0',
          x2: 'x1',
          y: 'count',
          fill: '#ffffff',
          stroke: '#333333',
          strokeWidth: 1
        }),
        Plot.ruleY([0])
      ]
    });

    // Clear previous content and append new plot
    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(plot);

    // Add custom tooltip handlers
    const rects = plot.querySelectorAll('rect');
    rects.forEach((rect, index) => {
      if (index < bins.length) {
        const bin = bins[index];
        rect.addEventListener('mouseenter', (e: MouseEvent) => {
          if (tooltipRef.current) {
            tooltipRef.current.innerHTML = `${bin.x0.toFixed(3)} - ${bin.x1.toFixed(3)}<br/>${bin.count} locations`;
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
      }
    });

    // Cleanup
    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [data, mode, visible, numBins]);

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
    </div>
  );
};

export default DistributionHistogram;
