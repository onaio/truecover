// ABOUTME: Modal for generating quadkey pixel grids at specified zoom levels
// ABOUTME: Displays zoom level reference table and estimates grid count based on viewport bounds

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { TacticalModal, TacticalButton, TacticalSelect, TacticalBadge, tacticalToast } from '../tactical-ui';
import { useAuth } from '@clerk/clerk-react';
import { pixelsApi } from '../services/api';

interface GeneratePixelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  currentBounds: [number, number, number, number] | null;
  onGenerated: () => void;
  geometry?: any;
}

const ZOOM_LEVELS = [
  { level: 0, metersPerPixel: 156543, metersTileSide: 40075017 },
  { level: 1, metersPerPixel: 78271.5, metersTileSide: 20037508 },
  { level: 2, metersPerPixel: 39135.8, metersTileSide: 10018754 },
  { level: 3, metersPerPixel: 19567.88, metersTileSide: 5009377.1 },
  { level: 4, metersPerPixel: 9783.94, metersTileSide: 2504688.5 },
  { level: 5, metersPerPixel: 4891.97, metersTileSide: 1252344.3 },
  { level: 6, metersPerPixel: 2445.98, metersTileSide: 626172.1 },
  { level: 7, metersPerPixel: 1222.99, metersTileSide: 313086.1 },
  { level: 8, metersPerPixel: 611.5, metersTileSide: 156543 },
  { level: 9, metersPerPixel: 305.75, metersTileSide: 78271.5 },
  { level: 10, metersPerPixel: 152.87, metersTileSide: 39135.8 },
  { level: 11, metersPerPixel: 76.44, metersTileSide: 19567.9 },
  { level: 12, metersPerPixel: 38.219, metersTileSide: 9783.94 },
  { level: 13, metersPerPixel: 19.109, metersTileSide: 4891.97 },
  { level: 14, metersPerPixel: 9.555, metersTileSide: 2445.98 },
  { level: 15, metersPerPixel: 4.777, metersTileSide: 1222.99 },
  { level: 16, metersPerPixel: 2.3887, metersTileSide: 611.496 },
  { level: 17, metersPerPixel: 1.1943, metersTileSide: 305.748 },
  { level: 18, metersPerPixel: 0.5972, metersTileSide: 152.874 },
  { level: 19, metersPerPixel: 0.2986, metersTileSide: 76.437 },
  { level: 20, metersPerPixel: 0.14929, metersTileSide: 38.2185 },
  { level: 21, metersPerPixel: 0.074646, metersTileSide: 19.10926 },
  { level: 22, metersPerPixel: 0.037323, metersTileSide: 9.55463 },
  { level: 23, metersPerPixel: 0.0186615, metersTileSide: 4.777315 },
  { level: 24, metersPerPixel: 0.00933075, metersTileSide: 2.3886575 },
];

const GeneratePixelsModal: React.FC<GeneratePixelsModalProps> = ({
  isOpen,
  onClose,
  campaignId,
  currentBounds,
  onGenerated,
  geometry
}) => {
  const { getToken } = useAuth();
  const [selectedLevel, setSelectedLevel] = useState<number>(18);
  const [isGenerating, setIsGenerating] = useState(false);
  const [, setWorkflowId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ pixels_inserted: number; total_pixels?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const shouldPollRef = useRef(false);

  // Rough estimate of tile count based on bbox and level
  const estimatedCount = useMemo(() => {
    if (!currentBounds) return null;

    const [minLng, minLat, maxLng, maxLat] = currentBounds;
    const lngSpan = maxLng - minLng;
    const latSpan = maxLat - minLat;

    // Rough approximation: number of tiles = 2^level * (lngSpan/360) * 2^level * (latSpan/180)
    const tilesX = Math.pow(2, selectedLevel) * (lngSpan / 360);
    const tilesY = Math.pow(2, selectedLevel) * (latSpan / 180);

    return Math.ceil(tilesX * tilesY);
  }, [currentBounds, selectedLevel]);

  // Poll for workflow status
  const pollWorkflowStatus = async (wfId: string, token: string) => {
    if (!shouldPollRef.current) return;

    try {
      const status = await pixelsApi.getGenerationStatus(wfId, token);

      if (status.status === 'running' && status.progress) {
        setProgress(status.progress);
      } else if (status.status === 'completed' && status.result) {
        // Workflow completed
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        shouldPollRef.current = false;
        setProgress(null);
        setIsGenerating(false);

        // Show success toast
        tacticalToast.success(
          'Pixels Generated',
          `Created ${status.result.count.toLocaleString()} pixels at level ${status.result.level}`
        );

        // Notify parent to refresh
        onGenerated();

        // Reset and close
        setTimeout(() => {
          handleClose();
        }, 1000);
      } else if (status.status === 'failed') {
        // Workflow failed
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
        shouldPollRef.current = false;
        setError(status.error || 'Workflow failed');
        setIsGenerating(false);
        setProgress(null);
        tacticalToast.error('Generation Failed', status.error || 'Pixel generation failed');
      }
    } catch (err: any) {
      console.error('Failed to get workflow status:', err);
    }
  };

  const handleGenerate = async () => {
    console.log('🚀 handleGenerate called');
    if (!currentBounds) {
      console.log('❌ No bounds');
      setError('No viewport bounds available. Please move the map first.');
      return;
    }

    console.log('✅ Setting isGenerating to true');
    setIsGenerating(true);
    setError(null);
    setProgress(null);

    try {
      console.log('🔑 Getting auth token...');
      const token = await getToken();
      if (!token) {
        console.log('❌ No token');
        setError('Authentication required');
        setIsGenerating(false);
        return;
      }

      console.log('📡 Starting workflow...', { campaignId, bounds: currentBounds, level: selectedLevel, geometry });
      // Start the workflow
      const response = await pixelsApi.generate(
        campaignId,
        currentBounds,
        selectedLevel,
        token,
        undefined,
        undefined,
        geometry
      );

      console.log('✅ Workflow started:', response);
      setWorkflowId(response.workflow_id);
      shouldPollRef.current = true;

      // Start polling for status
      pollIntervalRef.current = setInterval(() => {
        pollWorkflowStatus(response.workflow_id, token);
      }, 2000); // Poll every 2 seconds

      // Do first poll immediately
      pollWorkflowStatus(response.workflow_id, token);

    } catch (err: any) {
      console.error('❌ Failed to start pixel generation:', err);
      setError(err.response?.data?.error || 'Failed to start pixel generation');
      setIsGenerating(false);
      tacticalToast.error('Generation Failed', err.response?.data?.error || 'Failed to start pixel generation');
    }
  };

  const handleClose = () => {
    // Stop polling but don't clear the interval if still generating
    // This allows the workflow to continue in background
    if (!isGenerating) {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      shouldPollRef.current = false;
      setWorkflowId(null);
      setProgress(null);
      setError(null);
      onClose();
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      shouldPollRef.current = false;
    };
  }, []);

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Generate Pixels [UPDATED]"
      size="lg"
    >
      <div className="space-y-6">
        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-3 p-3 border border-tactical-accent-red bg-tactical-bg-secondary">
            <TacticalBadge variant="danger">ERROR</TacticalBadge>
            <span className="text-sm text-tactical-accent-red">{error}</span>
          </div>
        )}

        {/* Progress Message */}
        {isGenerating && (
          <div className="p-3 border border-tactical-accent-orange bg-tactical-bg-secondary space-y-2">
            <div className="flex items-center gap-3">
              <TacticalBadge variant="warning">GENERATING</TacticalBadge>
              <span className="text-sm text-tactical-accent-orange font-bold tactical-loading-dots">
                Generating pixels<span>.</span><span>.</span><span>.</span>
              </span>
            </div>
            {progress && (
              <div className="text-xs text-tactical-text-secondary ml-[76px]">
                <div>Pixels Inserted: {progress.pixels_inserted.toLocaleString()}</div>
                {progress.total_pixels && (
                  <div>Total: {progress.total_pixels.toLocaleString()}</div>
                )}
              </div>
            )}
            <div className="text-xs text-tactical-text-dim ml-[76px] mt-2">
              You can close this modal - pixels will continue generating in the background.
            </div>
          </div>
        )}

        {/* Current Viewport Bounds */}
        <div>
          <div className="mb-2 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
            Current Viewport Bounds
          </div>
          {currentBounds ? (
            <div className="p-3 bg-tactical-bg-tertiary border border-tactical-border-medium font-mono text-xs">
              [{currentBounds[0].toFixed(6)}, {currentBounds[1].toFixed(6)}, {currentBounds[2].toFixed(6)}, {currentBounds[3].toFixed(6)}]
            </div>
          ) : (
            <div className="p-3 bg-tactical-bg-tertiary border border-tactical-border-medium font-mono text-xs text-tactical-text-dim">
              No bounds available - move the map first
            </div>
          )}
        </div>

        {/* Zoom Level Selector */}
        <div>
          <div className="mb-2 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
            Zoom Level
          </div>
          <TacticalSelect
            value={String(selectedLevel)}
            onChange={(value) => setSelectedLevel(Number(value))}
            options={ZOOM_LEVELS.map(z => ({
              value: String(z.level),
              label: `Level ${z.level} (${z.metersTileSide.toLocaleString()}m tile side)`
            }))}
          />
        </div>

        {/* Estimated Count */}
        {estimatedCount !== null && (
          <div className="p-3 bg-tactical-bg-secondary border border-tactical-border-medium">
            <div className="font-mono text-xs text-tactical-text-muted mb-1">Estimated Grid Count</div>
            <div className="font-mono text-lg text-tactical-text-primary">
              ~{estimatedCount.toLocaleString()} pixels
            </div>
          </div>
        )}

        {/* Zoom Reference Table */}
        <div>
          <div className="mb-2 font-mono font-bold text-xs text-tactical-text-muted uppercase tracking-wider">
            Zoom Level Reference
          </div>
          <div className="border border-tactical-border-medium overflow-hidden">
            <div className="max-h-64 overflow-y-auto tactical-scrollbar">
              <table className="w-full text-xs font-mono">
                <thead className="bg-tactical-bg-tertiary sticky top-0">
                  <tr>
                    <th className="py-2 px-3 text-left font-bold text-tactical-text-muted">Level</th>
                    <th className="py-2 px-3 text-right font-bold text-tactical-text-muted">Meters/Pixel</th>
                    <th className="py-2 px-3 text-right font-bold text-tactical-text-muted">Meters/Tile Side</th>
                  </tr>
                </thead>
                <tbody>
                  {ZOOM_LEVELS.map((zoom) => (
                    <tr
                      key={zoom.level}
                      className={`border-t border-tactical-border-dark ${
                        zoom.level === selectedLevel
                          ? 'bg-tactical-accent-green/20'
                          : 'hover:bg-tactical-bg-tertiary'
                      }`}
                    >
                      <td className="py-2 px-3 text-tactical-text-primary">{zoom.level}</td>
                      <td className="py-2 px-3 text-right text-tactical-text-secondary">
                        {zoom.metersPerPixel.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-tactical-text-secondary">
                        {zoom.metersTileSide.toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <TacticalButton
            variant="secondary"
            onClick={handleClose}
            disabled={false}
          >
            {isGenerating ? 'Close (continues in background)' : 'Cancel'}
          </TacticalButton>
          <TacticalButton
            variant="primary"
            onClick={handleGenerate}
            disabled={!currentBounds || isGenerating}
          >
            {isGenerating ? (
              <span className="tactical-loading-dots">
                GENERATING<span>.</span><span>.</span><span>.</span>
              </span>
            ) : (
              'Generate Pixels'
            )}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default GeneratePixelsModal;
