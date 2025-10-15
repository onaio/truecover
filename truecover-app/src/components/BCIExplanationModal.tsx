// ABOUTME: Modal explaining BCI width with visual confidence interval examples
// ABOUTME: Shows real data with error bars representing 95% credible intervals

import React, { useEffect, useRef } from 'react';
import * as Plot from '@observablehq/plot';
import { TacticalModal } from '../tactical-ui';

interface BCIExplanationModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: any[];
  indicatorName?: string;
  numBins?: number;
}

const BCIExplanationModal: React.FC<BCIExplanationModalProps> = ({ isOpen, onClose, data, indicatorName, numBins = 12 }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !isOpen || !data || data.length === 0) {
      return;
    }

    // Filter to locations with predictions
    const validData = data
      .filter(d =>
        typeof d.prevalence_prediction === 'number' &&
        typeof d.prevalence_bci_width === 'number' &&
        !isNaN(d.prevalence_prediction) &&
        !isNaN(d.prevalence_bci_width)
      );

    if (validData.length === 0) {
      return;
    }

    // Calculate prevalence bins (matching the histogram)
    const prevalenceValues = validData.map(d => d.prevalence_prediction);
    const min = Math.min(...prevalenceValues);
    const max = Math.max(...prevalenceValues);
    const binWidth = (max - min) / numBins;

    // Create bins and calculate average BCI width for each bin
    const binData: any[] = [];
    const boundaries: number[] = [];

    for (let i = 0; i <= numBins; i++) {
      boundaries.push(min + i * binWidth);
    }

    for (let i = 0; i < numBins; i++) {
      const x0 = boundaries[i];
      const x1 = boundaries[i + 1];

      // Find all locations in this bin
      const locationsInBin = validData.filter(d => {
        const val = d.prevalence_prediction;
        return val >= x0 && (i === numBins - 1 ? val <= x1 : val < x1);
      });

      // Calculate average BCI width for this bin
      if (locationsInBin.length > 0) {
        const avgBCIWidth = locationsInBin.reduce((sum, d) => sum + d.prevalence_bci_width, 0) / locationsInBin.length;
        const binMidpoint = (x0 + x1) / 2;

        binData.push({
          x0,
          x1,
          binMidpoint,
          avgBCIWidth,
          count: locationsInBin.length
        });
      }
    }

    // Sort by prevalence (descending) for better visualization
    binData.sort((a, b) => b.binMidpoint - a.binMidpoint);

    // Prepare data for interval plot
    const intervalData = binData.map((d) => {
      const prediction = d.binMidpoint;
      const bciWidth = d.avgBCIWidth;
      const lower = Math.max(0, prediction - bciWidth / 2);
      const upper = Math.min(1, prediction + bciWidth / 2);

      return {
        location: `${(d.x0 * 100).toFixed(1)}% - ${(d.x1 * 100).toFixed(1)}% (n=${d.count})`,
        prediction,
        lower,
        upper,
        bciWidth
      };
    });

    const plot = Plot.plot({
      width: containerRef.current.clientWidth,
      height: 400,
      marginLeft: 100,
      marginRight: 40,
      marginTop: 30,
      marginBottom: 60,
      style: {
        background: '#0a0a0a',
        color: '#ffffff',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
      },
      x: {
        label: 'Prevalence',
        domain: [0, 1],
        grid: true,
        tickFormat: d => (d * 100).toFixed(0) + '%'
      },
      y: {
        label: null,
        domain: intervalData.map(d => d.location)
      },
      marks: [
        // Confidence interval lines
        Plot.ruleX(intervalData, {
          x1: 'lower',
          x2: 'upper',
          y: 'location',
          stroke: '#4a9eff',
          strokeWidth: 2
        }),
        // Lower bound markers
        Plot.dot(intervalData, {
          x: 'lower',
          y: 'location',
          fill: '#4a9eff',
          r: 4,
          title: d => `Lower bound: ${(d.lower * 100).toFixed(1)}%`
        }),
        // Upper bound markers
        Plot.dot(intervalData, {
          x: 'upper',
          y: 'location',
          fill: '#4a9eff',
          r: 4,
          title: d => `Upper bound: ${(d.upper * 100).toFixed(1)}%`
        }),
        // Point estimate
        Plot.dot(intervalData, {
          x: 'prediction',
          y: 'location',
          fill: '#ff6600',
          r: 5,
          stroke: '#ffffff',
          strokeWidth: 1,
          title: d => `Prevalence: ${(d.prediction * 100).toFixed(1)}%`
        }),
        // BCI margin labels (±)
        Plot.text(intervalData, {
          x: 1,
          y: 'location',
          text: d => `±${(d.bciWidth / 2).toFixed(3)}`,
          dx: -5,
          fill: '#ffffff',
          fontSize: 10,
          textAnchor: 'end',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
        })
      ]
    });

    containerRef.current.innerHTML = '';
    containerRef.current.appendChild(plot);

    // Add custom tooltips using the title elements that Plot creates
    const circles = Array.from(plot.querySelectorAll('circle'));

    circles.forEach((circle) => {
      // Get the title element that Observable Plot creates
      const titleElement = circle.querySelector('title');
      if (!titleElement) return;

      const tooltipText = titleElement.textContent || '';

      circle.addEventListener('mouseenter', (e: MouseEvent) => {
        if (tooltipRef.current) {
          tooltipRef.current.innerHTML = tooltipText;
          tooltipRef.current.style.display = 'block';
          tooltipRef.current.style.left = `${e.clientX + 10}px`;
          tooltipRef.current.style.top = `${e.clientY + 10}px`;
        }
      });

      circle.addEventListener('mousemove', (e: MouseEvent) => {
        if (tooltipRef.current) {
          tooltipRef.current.style.left = `${e.clientX + 10}px`;
          tooltipRef.current.style.top = `${e.clientY + 10}px`;
        }
      });

      circle.addEventListener('mouseleave', () => {
        if (tooltipRef.current) {
          tooltipRef.current.style.display = 'none';
        }
      });
    });

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [data, isOpen, numBins]);

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={onClose}
      title={`BCI Width Explanation${indicatorName ? ` - ${indicatorName}` : ''}`}
      width="xl"
    >
      <div className="space-y-4">
        <div className="text-sm font-mono text-tactical-text-primary space-y-2">
          <p>
            <span className="font-bold">BCI Width</span> (Bayesian Credible Interval Width) represents the uncertainty around each prevalence prediction.
          </p>
          <p>
            Each location has:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><span className="text-tactical-accent-orange font-bold">Orange dot</span>: Predicted prevalence (point estimate)</li>
            <li><span className="text-blue-400 font-bold">Blue line</span>: 95% credible interval (BCI width)</li>
          </ul>
          <p>
            A BCI width of 0.20 means we're 95% confident the true prevalence is within ±0.10 (±10%) of the prediction.
          </p>
        </div>

        <div className="border-t border-tactical-border-medium pt-4">
          <h4 className="font-mono font-bold text-tactical-text-primary uppercase tracking-wider text-xs mb-3">
            Prevalence Bins with Average BCI Width
          </h4>
          <div ref={containerRef} className="w-full"></div>
        </div>

        <div className="text-xs font-mono text-tactical-text-dim italic">
          Each row shows a prevalence bin with its average BCI width across all locations in that bin
        </div>

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
    </TacticalModal>
  );
};

export default BCIExplanationModal;
