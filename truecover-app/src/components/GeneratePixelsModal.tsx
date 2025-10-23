// ABOUTME: Modal for generating quadkey pixel grids at specified zoom levels
// ABOUTME: Displays zoom level reference table and estimates grid count based on viewport bounds

import React, { useState, useMemo } from 'react';
import { TacticalModal, TacticalButton, TacticalSelect } from '../tactical-ui';
import { useGeneratePixels } from '../hooks/usePixels';

interface GeneratePixelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  areaId: string;
  currentBounds: [number, number, number, number] | null;
  onGenerated: () => void;
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
  areaId,
  currentBounds,
  onGenerated
}) => {
  const [selectedLevel, setSelectedLevel] = useState<number>(18);
  const generatePixels = useGeneratePixels();

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

  const handleGenerate = async () => {
    if (!currentBounds) {
      alert('No viewport bounds available. Please move the map first.');
      return;
    }

    try {
      await generatePixels.mutateAsync({
        areaId,
        bbox: currentBounds,
        level: selectedLevel
      });

      onGenerated();
      onClose();
    } catch (error: any) {
      console.error('Error generating pixels:', error);
      alert(`Error generating pixels: ${error.message || 'Unknown error'}`);
    }
  };

  const handleClose = () => {
    if (!generatePixels.isPending) {
      onClose();
    }
  };

  return (
    <TacticalModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Generate Pixels"
      size="lg"
    >
      <div className="space-y-6">
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
            disabled={generatePixels.isPending}
          >
            Cancel
          </TacticalButton>
          <TacticalButton
            variant="primary"
            onClick={handleGenerate}
            disabled={!currentBounds || generatePixels.isPending}
          >
            {generatePixels.isPending ? 'Generating...' : 'Generate Pixels'}
          </TacticalButton>
        </div>
      </div>
    </TacticalModal>
  );
};

export default GeneratePixelsModal;
